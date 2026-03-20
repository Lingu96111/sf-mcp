// Flow 定义、版本与 VersionData 查询（只读）
import { z } from "zod";
import {
  sfRestGet,
  sfToolingQuery,
  sfQueryAll,
  limitValue,
  escapeSoqlLiteral,
  validatePathParam,
  DEFAULT_LIMIT_MAX
} from "../core/connection.js";
import { textContent } from "../core/utils.js";
import { parseFlowStructFromXml } from "../core/flowStructParse.js";

/** Apex 类名在 VersionData 中搜索时，单次扫描的 FlowDefinition 上限 */
const APEX_FLOW_SCAN_MAX = 60;
/** get_flow_version_data 返回的 VersionData 超过此长度则截断并提示 */
const VERSION_DATA_MAX_CHARS = 800000;
/** diff 时每侧最多比较的字符数（避免超大 XML） */
const DIFF_XML_MAX_CHARS = 400000;
/** describe 允许的 Tooling 对象名（防路径注入） */
const TOOLING_OBJ_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;

// 拉取 FlowVersion 全记录（含 VersionData）
async function fetchVerBodyById(flowVersionId) {
  const safeId = validatePathParam(flowVersionId, "flowVersionId");
  const pathStr = `/tooling/sobjects/FlowVersion/${safeId}`;
  return sfRestGet(pathStr);
}

// 统计 XML 中某标签出现次数（开始标签）
function countXmlTagOpen(xmlStr, tagName) {
  const re = new RegExp(`<${tagName}\\b`, "gi");
  return (xmlStr.match(re) || []).length;
}

// 取标签内文本（所有匹配，去重）
function collectTagTextList(xmlStr, tagName) {
  const re = new RegExp(`<${tagName}[^>]*>([^<]*)</${tagName}>`, "gi");
  const valSet = new Set();
  let m;
  while ((m = re.exec(xmlStr)) !== null) {
    const v = (m[1] || "").trim();
    if (v) valSet.add(v);
  }
  return [...valSet];
}

// 从 VersionData（XML）生成可读摘要（启发式，非完整元数据解析）
function buildFlowXmlSummary(xmlStr) {
  if (!xmlStr || typeof xmlStr !== "string") {
    return { _parseNote: "VersionData 为空或非字符串" };
  }
  const procList = collectTagTextList(xmlStr, "processType");
  const apiVerList = collectTagTextList(xmlStr, "apiVersion");
  const trigTypeList = collectTagTextList(xmlStr, "triggerType");
  const objList = collectTagTextList(xmlStr, "object");
  const apexList = collectTagTextList(xmlStr, "apexClass");
  const flowNameList = collectTagTextList(xmlStr, "flowName");
  const actionNameList = collectTagTextList(xmlStr, "actionName");
  const actionTypeList = collectTagTextList(xmlStr, "actionType");
  const elemCountMap = {
    decisions: countXmlTagOpen(xmlStr, "decisions"),
    loops: countXmlTagOpen(xmlStr, "loops"),
    assignments: countXmlTagOpen(xmlStr, "assignments"),
    recordCreates: countXmlTagOpen(xmlStr, "recordCreates"),
    recordUpdates: countXmlTagOpen(xmlStr, "recordUpdates"),
    recordDeletes: countXmlTagOpen(xmlStr, "recordDeletes"),
    recordLookups: countXmlTagOpen(xmlStr, "recordLookups"),
    screens: countXmlTagOpen(xmlStr, "screens"),
    actionCalls: countXmlTagOpen(xmlStr, "actionCalls"),
    subflows: countXmlTagOpen(xmlStr, "subflows"),
    waits: countXmlTagOpen(xmlStr, "waits"),
    customErrors: countXmlTagOpen(xmlStr, "customErrors")
  };
  return {
    processTypeList: procList,
    apiVersionList: apiVerList,
    triggerTypeList: trigTypeList,
    referencedObjectList: objList.slice(0, 80),
    apexClassList: apexList,
    subflowDeveloperNameList: flowNameList,
    actionNameList: actionNameList.slice(0, 60),
    actionTypeList: actionTypeList.slice(0, 40),
    elementCountMap: elemCountMap,
    _parseNote:
      "由正则从 VersionData 提取，复杂 Flow 可能不完整；细节请用 get_flow_version_data。"
  };
}

// 两版 XML 按行找首个差异位置
function buildXmlLineDiff(xmlA, xmlB, ctxLineCount) {
  const lineListA = xmlA.split(/\r?\n/);
  const lineListB = xmlB.split(/\r?\n/);
  let idx = 0;
  const maxIdx = Math.min(lineListA.length, lineListB.length);
  while (idx < maxIdx && lineListA[idx] === lineListB[idx]) idx += 1;
  const fromA = Math.max(0, idx - ctxLineCount);
  const fromB = Math.max(0, idx - ctxLineCount);
  return {
    identicalPrefixLineCount: idx,
    lineCountA: lineListA.length,
    lineCountB: lineListB.length,
    firstDiffLineIndex0: idx,
    lineAtA: lineListA[idx] ?? null,
    lineAtB: lineListB[idx] ?? null,
    contextLineListA: lineListA.slice(fromA, idx + ctxLineCount + 1),
    contextLineListB: lineListB.slice(fromB, idx + ctxLineCount + 1)
  };
}

// 子流程：flowName 标签（含 subflows 内与其它位置的引用）
function buildSubflowDepList(xmlStr) {
  const summary = buildFlowXmlSummary(xmlStr);
  const nameList = summary.subflowDeveloperNameList || [];
  return [...new Set(nameList)];
}

// list_flows_by_filter：至少一项筛选
function assertHasFlowFilter(args) {
  const keys = [
    "processType",
    "triggerType",
    "triggerObject",
    "status",
    "masterLabelLike"
  ];
  const has = keys.some((k) => {
    const v = args[k];
    return v != null && String(v).trim() !== "";
  });
  if (!has) {
    throw new Error(
      "请至少指定 processType、triggerType、triggerObject、status、masterLabelLike 之一"
    );
  }
}

const flowScopeShape = {
  flowDefinitionId: z
    .string()
    .optional()
    .describe("FlowDefinition Id（18 位）"),
  flowDeveloperName: z
    .string()
    .optional()
    .describe("Flow 的 DeveloperName（API 名）"),
  flowId: z
    .string()
    .optional()
    .describe(
      "Tooling Flow 版本 Id、FlowVersion Id 或 FlowDefinition Id（自动识别）"
    )
};

// 校验三选一且仅选一个
function assertExactlyOneScope(args) {
  const { flowDefinitionId, flowDeveloperName, flowId } = args;
  const cnt = [flowDefinitionId, flowDeveloperName, flowId].filter(
    (v) => v != null && String(v).trim() !== ""
  ).length;
  if (cnt !== 1) {
    throw new Error(
      "请在 flowDefinitionId、flowDeveloperName、flowId 中**仅填写一个**"
    );
  }
}

// 解析为 FlowDefinition Id
async function resolveToFlowDefId(args) {
  assertExactlyOneScope(args);
  const { flowDefinitionId, flowDeveloperName, flowId } = args;

  if (flowDefinitionId) {
    return validatePathParam(flowDefinitionId, "flowDefinitionId");
  }

  if (flowDeveloperName) {
    const safeName = escapeSoqlLiteral(flowDeveloperName);
    const soql = `SELECT Id FROM FlowDefinition WHERE DeveloperName = '${safeName}' LIMIT 1`;
    const resultData = await sfToolingQuery(soql);
    const recList = resultData.records || [];
    if (recList.length === 0) {
      throw new Error(
        `未找到 DeveloperName 为 '${flowDeveloperName}' 的 FlowDefinition`
      );
    }
    return recList[0].Id;
  }

  const safeFlowId = validatePathParam(flowId, "flowId");

  // 1) 当作 FlowVersion Id
  try {
    const q1 = `SELECT FlowDefinitionId FROM FlowVersion WHERE Id = '${safeFlowId}' LIMIT 1`;
    const r1 = await sfToolingQuery(q1);
    const list1 = r1.records || [];
    if (list1.length > 0 && list1[0].FlowDefinitionId) {
      return list1[0].FlowDefinitionId;
    }
  } catch (_) {}

  // 2) 当作 Tooling Flow（某版本）上的 DefinitionId
  try {
    const q2 = `SELECT DefinitionId FROM Flow WHERE Id = '${safeFlowId}' LIMIT 1`;
    const r2 = await sfToolingQuery(q2);
    const list2 = r2.records || [];
    if (list2.length > 0 && list2[0].DefinitionId) {
      return list2[0].DefinitionId;
    }
  } catch (_) {}

  // 3) 当作 FlowDefinition Id
  try {
    const q3 = `SELECT Id FROM FlowDefinition WHERE Id = '${safeFlowId}' LIMIT 1`;
    const r3 = await sfToolingQuery(q3);
    if ((r3.records || []).length > 0) return safeFlowId;
  } catch (_) {}

  throw new Error(
    `无法从 flowId 解析出 FlowDefinition：${flowId}（请确认是 Flow / FlowVersion / FlowDefinition 的 Id）`
  );
}

function mapFlowDefRec(rec) {
  return {
    Id: rec.Id || "",
    DeveloperName: rec.DeveloperName || "",
    MasterLabel: rec.MasterLabel || "",
    ActiveVersionId: rec.ActiveVersionId || "",
    LatestVersionId: rec.LatestVersionId || ""
  };
}

function mapFlowVerRec(rec) {
  return {
    Id: rec.Id || "",
    FlowDefinitionId: rec.FlowDefinitionId || "",
    VersionNumber: rec.VersionNumber ?? "",
    Status: rec.Status || "",
    LastModifiedDate: rec.LastModifiedDate || ""
  };
}

export function registerToolsFlow(mcpServer) {
  mcpServer.tool(
    "get_flow_by_developer_name",
    "按 DeveloperName 查询 FlowDefinition：MasterLabel、Active/Latest 版本 Id 等（只读）。",
    { flowDeveloperName: z.string().describe("Flow 的 DeveloperName") },
    async ({ flowDeveloperName }) => {
      const safeName = escapeSoqlLiteral(flowDeveloperName);
      const soql = `SELECT Id, DeveloperName, MasterLabel, ActiveVersionId, LatestVersionId FROM FlowDefinition WHERE DeveloperName = '${safeName}' LIMIT 1`;
      try {
        const resultData = await sfToolingQuery(soql);
        const recList = resultData.records || [];
        if (recList.length === 0) {
          return textContent({
            error: `未找到 DeveloperName='${flowDeveloperName}' 的 FlowDefinition`
          });
        }
        return textContent(mapFlowDefRec(recList[0]));
      } catch (exc) {
        const errMsg = exc?.message || String(exc);
        return textContent({
          error: `get_flow_by_developer_name 失败: ${errMsg}`,
          hint:
            "若仍失败，可用 run_tooling_query 自定义查询 FlowDefinition 字段。"
        });
      }
    }
  );

  mcpServer.tool(
    "list_flows",
    "列出 FlowDefinition（可按标签/API 名模糊匹配），只读。",
    {
      nameLike: z.string().optional().describe("匹配 DeveloperName 或 MasterLabel"),
      limit: z.number().optional().default(100).describe("最大条数，最大 200")
    },
    async ({ nameLike, limit }) => {
      const safeLimit = limitValue(limit, DEFAULT_LIMIT_MAX);
      let whereSql = "";
      if (nameLike && nameLike.trim()) {
        const safeLike = escapeSoqlLiteral(nameLike.trim());
        whereSql = `WHERE (DeveloperName LIKE '%${safeLike}%' OR MasterLabel LIKE '%${safeLike}%')`;
      }
      const soql = `SELECT Id, DeveloperName, MasterLabel, ActiveVersionId, LatestVersionId FROM FlowDefinition ${whereSql} ORDER BY MasterLabel LIMIT ${safeLimit}`;
      try {
        const resultData = await sfToolingQuery(soql);
        const outList = (resultData.records || []).map((rec) =>
          mapFlowDefRec(rec)
        );
        return textContent(outList);
      } catch (exc) {
        const errMsg = exc?.message || String(exc);
        return textContent({
          error: `list_flows 失败: ${errMsg}`,
          hint: "可改用 run_tooling_query 自定义查询 FlowDefinition。"
        });
      }
    }
  );

  mcpServer.tool(
    "get_flow_versions",
    "列出某 Flow 的所有 FlowVersion（版本号、状态等，不含 VersionData）。flowDefinitionId / flowDeveloperName / flowId 三选一。",
    { ...flowScopeShape },
    async (args) => {
      try {
        const defId = await resolveToFlowDefId(args);
        const safeDef = escapeSoqlLiteral(defId);
        const soql = `SELECT Id, FlowDefinitionId, VersionNumber, Status, LastModifiedDate FROM FlowVersion WHERE FlowDefinitionId = '${safeDef}' ORDER BY VersionNumber DESC LIMIT 200`;
        const resultData = await sfToolingQuery(soql);
        const verList = (resultData.records || []).map((rec) =>
          mapFlowVerRec(rec)
        );
        return textContent({ flowDefinitionId: defId, versions: verList });
      } catch (exc) {
        return textContent({ error: exc?.message || String(exc) });
      }
    }
  );

  mcpServer.tool(
    "get_flow_active_version",
    "取当前激活的 FlowVersion 摘要（不含 VersionData）。flowDefinitionId / flowDeveloperName / flowId 三选一。",
    { ...flowScopeShape },
    async (args) => {
      try {
        const defId = await resolveToFlowDefId(args);
        const safeDef = escapeSoqlLiteral(defId);
        const soqlDef = `SELECT Id, ActiveVersionId, LatestVersionId, DeveloperName, MasterLabel FROM FlowDefinition WHERE Id = '${safeDef}' LIMIT 1`;
        const defResult = await sfToolingQuery(soqlDef);
        const defList = defResult.records || [];
        if (defList.length === 0) {
          return textContent({ error: `FlowDefinition 不存在: ${defId}` });
        }
        const defRec = defList[0];
        const activeId = defRec.ActiveVersionId || "";
        if (!activeId) {
          return textContent({
            flowDefinitionId: defId,
            definition: {
              Id: defRec.Id || "",
              DeveloperName: defRec.DeveloperName || "",
              MasterLabel: defRec.MasterLabel || "",
              ActiveVersionId: defRec.ActiveVersionId || "",
              LatestVersionId: defRec.LatestVersionId || ""
            },
            activeVersion: null,
            message: "当前无 ActiveVersionId（可能仅有草稿或未激活版本）"
          });
        }
        const safeVer = escapeSoqlLiteral(activeId);
        const soqlVer = `SELECT Id, FlowDefinitionId, VersionNumber, Status, LastModifiedDate FROM FlowVersion WHERE Id = '${safeVer}' LIMIT 1`;
        const verResult = await sfToolingQuery(soqlVer);
        const verList = verResult.records || [];
        return textContent({
          flowDefinitionId: defId,
          definition: {
            Id: defRec.Id || "",
            DeveloperName: defRec.DeveloperName || "",
            MasterLabel: defRec.MasterLabel || "",
            ActiveVersionId: defRec.ActiveVersionId || "",
            LatestVersionId: defRec.LatestVersionId || ""
          },
          activeVersion:
            verList.length > 0 ? mapFlowVerRec(verList[0]) : { Id: activeId }
        });
      } catch (exc) {
        return textContent({ error: exc?.message || String(exc) });
      }
    }
  );

  mcpServer.tool(
    "get_flow_version_data",
    "按 FlowVersion Id 获取完整记录，含 VersionData（流程 XML，可能很大；超长会截断）。只读。",
    { flowVersionId: z.string().describe("FlowVersion 的 Id") },
    async ({ flowVersionId }) => {
      try {
        const safeId = validatePathParam(flowVersionId, "flowVersionId");
        const pathStr = `/tooling/sobjects/FlowVersion/${safeId}`;
        const raw = await sfRestGet(pathStr);
        const vd = raw.VersionData;
        let versionDataOut = vd;
        let truncated = false;
        if (typeof vd === "string" && vd.length > VERSION_DATA_MAX_CHARS) {
          versionDataOut = vd.slice(0, VERSION_DATA_MAX_CHARS);
          truncated = true;
        }
        const outObj = {
          Id: raw.Id || "",
          FlowDefinitionId: raw.FlowDefinitionId || "",
          VersionNumber: raw.VersionNumber ?? "",
          Status: raw.Status || "",
          LastModifiedDate: raw.LastModifiedDate || "",
          VersionData: versionDataOut,
          _versionDataTruncated: truncated,
          _versionDataOriginalLength:
            typeof vd === "string" ? vd.length : undefined
        };
        return textContent(outObj);
      } catch (exc) {
        return textContent({ error: exc?.message || String(exc) });
      }
    }
  );

  mcpServer.tool(
    "search_flows_by_apex_class_reference",
    "在 FlowVersion.VersionData 中搜索 Apex 类名引用（先尝试 SOQL LIKE；若 Org 不支持则扫描最近修改的 FlowDefinition 的 LatestVersion）。只读。",
    {
      apexClassName: z.string().describe("Apex 类名（不含 .cls）"),
      limit: z
        .number()
        .optional()
        .default(20)
        .describe("最多返回几条匹配"),
      maxScanDefinitions: z
        .number()
        .optional()
        .default(40)
        .describe("LIKE 不可用时扫描的 FlowDefinition 数量上限")
    },
    async ({ apexClassName, limit, maxScanDefinitions }) => {
      const matchLimit = limitValue(limit, 50);
      const scanCap = limitValue(maxScanDefinitions, APEX_FLOW_SCAN_MAX);
      const safeClass = escapeSoqlLiteral(apexClassName.trim());

      async function scanByDefinitions() {
        const soqlDefs = `SELECT Id, DeveloperName, MasterLabel, LatestVersionId FROM FlowDefinition ORDER BY LastModifiedDate DESC LIMIT ${scanCap}`;
        const defResult = await sfToolingQuery(soqlDefs);
        const defRecList = defResult.records || [];
        const hitList = [];
        for (const defRec of defRecList) {
          if (hitList.length >= matchLimit) break;
          const verId = defRec.LatestVersionId;
          if (!verId) continue;
          try {
            const pathStr = `/tooling/sobjects/FlowVersion/${validatePathParam(verId, "flowVersionId")}`;
            const verBody = await sfRestGet(pathStr);
            const vd = verBody.VersionData || "";
            if (
              typeof vd === "string" &&
              vd.includes(apexClassName.trim())
            ) {
              hitList.push({
                flowDefinitionId: defRec.Id || "",
                developerName: defRec.DeveloperName || "",
                masterLabel: defRec.MasterLabel || "",
                flowVersionId: verBody.Id || verId,
                versionNumber: verBody.VersionNumber ?? "",
                status: verBody.Status || ""
              });
            }
          } catch (_) {}
        }
        return hitList;
      }

      try {
        const likeSoql = `SELECT Id, FlowDefinitionId, VersionNumber, Status FROM FlowVersion WHERE VersionData LIKE '%${safeClass}%' ORDER BY LastModifiedDate DESC LIMIT ${matchLimit}`;
        const likeResult = await sfToolingQuery(likeSoql);
        const recList = likeResult.records || [];
        if (recList.length > 0) {
          return textContent({
            mode: "soql_like",
            apexClassName: apexClassName.trim(),
            matches: recList.map((rec) => ({
              flowVersionId: rec.Id || "",
              flowDefinitionId: rec.FlowDefinitionId || "",
              versionNumber: rec.VersionNumber ?? "",
              status: rec.Status || ""
            }))
          });
        }
      } catch (_) {}

      try {
        const hitList = await scanByDefinitions();
        return textContent({
          mode: "scan_latest_versions",
          apexClassName: apexClassName.trim(),
          scannedDefinitionsCap: scanCap,
          matches: hitList,
          note:
            hitList.length === 0
              ? "未在扫描范围内发现匹配；可增大 maxScanDefinitions 或改用 get_flow_version_data 检查指定版本。"
              : undefined
        });
      } catch (exc) {
        return textContent({ error: exc?.message || String(exc) });
      }
    }
  );

  mcpServer.tool(
    "get_flow_version_summary",
    "从 FlowVersion 的 VersionData（XML）提取可读摘要：processType、触发相关、Apex/子流程引用、元素计数等（启发式，只读）。",
    { flowVersionId: z.string().describe("FlowVersion Id") },
    async ({ flowVersionId }) => {
      try {
        const verBody = await fetchVerBodyById(flowVersionId);
        const vd = verBody.VersionData || "";
        const metaObj = {
          flowVersionId: verBody.Id || flowVersionId,
          flowDefinitionId: verBody.FlowDefinitionId || "",
          versionNumber: verBody.VersionNumber ?? "",
          status: verBody.Status || ""
        };
        return textContent({
          meta: metaObj,
          summary: buildFlowXmlSummary(vd)
        });
      } catch (exc) {
        return textContent({ error: exc?.message || String(exc) });
      }
    }
  );

  mcpServer.tool(
    "parse_flow_structure",
    "完整解析 FlowVersion.VersionData（MDAPI XML）为结构化 JSON：header、start、variables/constants/formulas、逐元素索引（含完整 detail 与 targetReference 列表）、connectorEdgeList；可选 includeFullTree（截断）。供 AI 排查连接器/元素/公式/触发配置错误。只读。",
    {
      flowVersionId: z.string().describe("FlowVersion Id"),
      includeFullTree: z
        .boolean()
        .optional()
        .default(false)
        .describe("是否附加完整解析树 JSON 字符串（体积大）"),
      fullTreeMaxChars: z
        .number()
        .optional()
        .default(150000)
        .describe("fullTreeJson 最大字符数"),
      maxElemDetailChars: z
        .number()
        .optional()
        .default(40000)
        .describe("单元素 detail 的 JSON 最大长度"),
      maxIndexedElements: z
        .number()
        .optional()
        .default(450)
        .describe("elementIndex 最大条数")
    },
    async ({
      flowVersionId,
      includeFullTree,
      fullTreeMaxChars,
      maxElemDetailChars,
      maxIndexedElements
    }) => {
      try {
        const verBody = await fetchVerBodyById(flowVersionId);
        const vd = String(verBody.VersionData || "");
        const parsedObj = parseFlowStructFromXml(vd, {
          includeFullTree,
          fullTreeMaxChars: limitValue(fullTreeMaxChars, 2_000_000),
          maxElemDetailChars: limitValue(maxElemDetailChars, 500_000),
          maxIndexedElements: limitValue(maxIndexedElements, 800)
        });
        if (!parsedObj.ok) {
          return textContent({
            error: parsedObj.errorMsg,
            meta: {
              flowVersionId: verBody.Id || flowVersionId,
              flowDefinitionId: verBody.FlowDefinitionId || "",
              versionNumber: verBody.VersionNumber ?? ""
            }
          });
        }
        const { ok: _ok, ...restParsed } = parsedObj;
        return textContent({
          meta: {
            flowVersionId: verBody.Id || flowVersionId,
            flowDefinitionId: verBody.FlowDefinitionId || "",
            versionNumber: verBody.VersionNumber ?? "",
            status: verBody.Status || ""
          },
          ...restParsed
        });
      } catch (exc) {
        return textContent({ error: exc?.message || String(exc) });
      }
    }
  );

  mcpServer.tool(
    "diff_flow_versions",
    "对比两个 FlowVersion 的 VersionData：各自摘要 + 按行首个差异位置（XML 过大时截断后再比）。只读。",
    {
      flowVersionIdA: z.string().describe("第一个 FlowVersion Id"),
      flowVersionIdB: z.string().describe("第二个 FlowVersion Id"),
      contextLines: z
        .number()
        .optional()
        .default(4)
        .describe("差异行上下文字行数")
    },
    async ({ flowVersionIdA, flowVersionIdB, contextLines }) => {
      try {
        const ctxN = limitValue(contextLines, 20);
        const bodyA = await fetchVerBodyById(flowVersionIdA);
        const bodyB = await fetchVerBodyById(flowVersionIdB);
        let xmlA = String(bodyA.VersionData || "");
        let xmlB = String(bodyB.VersionData || "");
        let truncA = false;
        let truncB = false;
        if (xmlA.length > DIFF_XML_MAX_CHARS) {
          xmlA = xmlA.slice(0, DIFF_XML_MAX_CHARS);
          truncA = true;
        }
        if (xmlB.length > DIFF_XML_MAX_CHARS) {
          xmlB = xmlB.slice(0, DIFF_XML_MAX_CHARS);
          truncB = true;
        }
        const sumA = buildFlowXmlSummary(xmlA);
        const sumB = buildFlowXmlSummary(xmlB);
        const lineDiff = buildXmlLineDiff(xmlA, xmlB, ctxN);
        return textContent({
          versionA: {
            id: bodyA.Id || flowVersionIdA,
            flowDefinitionId: bodyA.FlowDefinitionId,
            versionNumber: bodyA.VersionNumber,
            summary: sumA
          },
          versionB: {
            id: bodyB.Id || flowVersionIdB,
            flowDefinitionId: bodyB.FlowDefinitionId,
            versionNumber: bodyB.VersionNumber,
            summary: sumB
          },
          lineDiff,
          _truncatedForDiff: { A: truncA, B: truncB }
        });
      } catch (exc) {
        return textContent({ error: exc?.message || String(exc) });
      }
    }
  );

  mcpServer.tool(
    "list_flows_by_filter",
    "按 Tooling Flow 字段筛选列表（ProcessType / TriggerType / TriggerObject / Status / MasterLabel 模糊）。至少填一个条件；只读。常见 ProcessType：Flow、AutoLaunchedFlow、Orchestration 等（以 Org 为准）。",
    {
      processType: z.string().optional().describe("ProcessType 精确匹配"),
      triggerType: z.string().optional().describe("TriggerType 精确匹配"),
      triggerObject: z.string().optional().describe("TriggerObject 精确匹配"),
      status: z.string().optional().describe("Status 精确匹配，如 Active"),
      masterLabelLike: z
        .string()
        .optional()
        .describe("MasterLabel 模糊匹配"),
      limit: z.number().optional().default(100).describe("最大条数，最大 200")
    },
    async (args) => {
      try {
        assertHasFlowFilter(args);
        const safeLimit = limitValue(args.limit, DEFAULT_LIMIT_MAX);
        const partList = [];
        if (args.processType && String(args.processType).trim()) {
          partList.push(
            `ProcessType = '${escapeSoqlLiteral(String(args.processType).trim())}'`
          );
        }
        if (args.triggerType && String(args.triggerType).trim()) {
          partList.push(
            `TriggerType = '${escapeSoqlLiteral(String(args.triggerType).trim())}'`
          );
        }
        if (args.triggerObject && String(args.triggerObject).trim()) {
          partList.push(
            `TriggerObject = '${escapeSoqlLiteral(String(args.triggerObject).trim())}'`
          );
        }
        if (args.status && String(args.status).trim()) {
          partList.push(
            `Status = '${escapeSoqlLiteral(String(args.status).trim())}'`
          );
        }
        if (args.masterLabelLike && String(args.masterLabelLike).trim()) {
          const safeLike = escapeSoqlLiteral(
            String(args.masterLabelLike).trim()
          );
          partList.push(`MasterLabel LIKE '%${safeLike}%'`);
        }
        const whereSql = partList.length ? `WHERE ${partList.join(" AND ")}` : "";
        const soql = `SELECT Id, MasterLabel, ProcessType, TriggerType, TriggerObject, Status, VersionNumber, LastModifiedDate, DefinitionId FROM Flow ${whereSql} ORDER BY LastModifiedDate DESC LIMIT ${safeLimit}`;
        try {
          const resultData = await sfToolingQuery(soql);
          const rowList = (resultData.records || []).map((rec) => ({
            Id: rec.Id || "",
            MasterLabel: rec.MasterLabel || "",
            ProcessType: rec.ProcessType || "",
            TriggerType: rec.TriggerType || "",
            TriggerObject: rec.TriggerObject || "",
            Status: rec.Status || "",
            VersionNumber: rec.VersionNumber ?? "",
            LastModifiedDate: rec.LastModifiedDate || "",
            DefinitionId: rec.DefinitionId || ""
          }));
          return textContent(rowList);
        } catch (innerExc) {
          const soql2 = soql.replace(
            ", DefinitionId",
            ""
          );
          const resultData = await sfToolingQuery(soql2);
          const rowList = (resultData.records || []).map((rec) => ({
            Id: rec.Id || "",
            MasterLabel: rec.MasterLabel || "",
            ProcessType: rec.ProcessType || "",
            TriggerType: rec.TriggerType || "",
            TriggerObject: rec.TriggerObject || "",
            Status: rec.Status || "",
            VersionNumber: rec.VersionNumber ?? "",
            LastModifiedDate: rec.LastModifiedDate || ""
          }));
          return textContent({
            rows: rowList,
            note: "当前 Org 的 Flow 无 DefinitionId 字段，已省略该列。"
          });
        }
      } catch (exc) {
        return textContent({ error: exc?.message || String(exc) });
      }
    }
  );

  mcpServer.tool(
    "get_subflow_dependencies",
    "从指定 FlowVersion 的 VersionData 中解析子流程引用（flowName 等），去重列表，只读。",
    { flowVersionId: z.string().describe("FlowVersion Id") },
    async ({ flowVersionId }) => {
      try {
        const verBody = await fetchVerBodyById(flowVersionId);
        const vd = verBody.VersionData || "";
        const subNameList = buildSubflowDepList(vd);
        return textContent({
          flowVersionId: verBody.Id || flowVersionId,
          flowDefinitionId: verBody.FlowDefinitionId || "",
          subflowDeveloperNameList: subNameList,
          count: subNameList.length
        });
      } catch (exc) {
        return textContent({ error: exc?.message || String(exc) });
      }
    }
  );

  mcpServer.tool(
    "get_flow_faults_or_errors",
    "尽力查询 Flow 相关故障信息：Tooling FlowInterview；失败时尝试 EventLogFile 中含 Flow 的 EventType。不同 Org/许可证下可能无数据或报错，只读。",
    {
      interviewLimit: z
        .number()
        .optional()
        .default(25)
        .describe("FlowInterview 最大条数"),
      eventLogLimit: z
        .number()
        .optional()
        .default(15)
        .describe("EventLogFile 最大条数")
    },
    async ({ interviewLimit, eventLogLimit }) => {
      const outObj = { flowInterviews: null, eventLogFiles: null };
      const safeIv = limitValue(interviewLimit, 50);
      const safeEv = limitValue(eventLogLimit, 50);
      try {
        const iq = `SELECT Id, InterviewLabel, CurrentElement, LastModifiedDate FROM FlowInterview ORDER BY LastModifiedDate DESC LIMIT ${safeIv}`;
        let ir;
        try {
          ir = await sfQueryAll(iq);
        } catch (_) {
          ir = await sfToolingQuery(iq);
        }
        outObj.flowInterviews = {
          ok: true,
          records: ir.records || []
        };
      } catch (exc) {
        outObj.flowInterviews = {
          ok: false,
          error: exc?.message || String(exc)
        };
      }
      try {
        const eq = `SELECT Id, EventType, LogDate, LogFileLength FROM EventLogFile WHERE EventType LIKE '%Flow%' ORDER BY LogDate DESC LIMIT ${safeEv}`;
        const er = await sfQueryAll(eq);
        outObj.eventLogFiles = {
          ok: true,
          records: (er.records || []).map((rec) => ({
            Id: rec.Id || "",
            EventType: rec.EventType || "",
            LogDate: rec.LogDate || "",
            LogFileLength: rec.LogFileLength ?? 0
          }))
        };
      } catch (exc) {
        outObj.eventLogFiles = {
          ok: false,
          error: exc?.message || String(exc)
        };
      }
      return textContent(outObj);
    }
  );

  mcpServer.tool(
    "list_orchestration_flows",
    "列出 ProcessType 为 Orchestration 的 Tooling Flow 记录（编排流），只读。",
    {
      limit: z.number().optional().default(100).describe("最大条数，最大 200")
    },
    async ({ limit }) => {
      const safeLimit = limitValue(limit, DEFAULT_LIMIT_MAX);
      const soql = `SELECT Id, MasterLabel, ProcessType, TriggerType, TriggerObject, Status, VersionNumber, LastModifiedDate, DefinitionId FROM Flow WHERE ProcessType = 'Orchestration' ORDER BY LastModifiedDate DESC LIMIT ${safeLimit}`;
      try {
        const resultData = await sfToolingQuery(soql);
        const rowList = (resultData.records || []).map((rec) => ({
          Id: rec.Id || "",
          MasterLabel: rec.MasterLabel || "",
          ProcessType: rec.ProcessType || "",
          Status: rec.Status || "",
          VersionNumber: rec.VersionNumber ?? "",
          LastModifiedDate: rec.LastModifiedDate || ""
        }));
        return textContent(rowList);
      } catch (exc) {
        try {
          const soql2 = `SELECT Id, MasterLabel, ProcessType, TriggerType, TriggerObject, Status, VersionNumber, LastModifiedDate FROM Flow WHERE ProcessType = 'Orchestration' ORDER BY LastModifiedDate DESC LIMIT ${safeLimit}`;
          const resultData = await sfToolingQuery(soql2);
          return textContent(resultData.records || []);
        } catch (exc2) {
          return textContent({
            error: exc2?.message || String(exc2)
          });
        }
      }
    }
  );

  mcpServer.tool(
    "list_workflow_process_flows",
    "列出 ProcessType 为 Workflow 的 Tooling Flow（部分 Org 中对应经典工作流/流程类自动化）；若无数据可改用 get_workflows_for_object。只读。",
    {
      limit: z.number().optional().default(100).describe("最大条数，最大 200")
    },
    async ({ limit }) => {
      const safeLimit = limitValue(limit, DEFAULT_LIMIT_MAX);
      const soql = `SELECT Id, MasterLabel, ProcessType, TriggerType, TriggerObject, Status, VersionNumber, LastModifiedDate FROM Flow WHERE ProcessType = 'Workflow' ORDER BY LastModifiedDate DESC LIMIT ${safeLimit}`;
      try {
        const resultData = await sfToolingQuery(soql);
        const rowList = (resultData.records || []).map((rec) => ({
          Id: rec.Id || "",
          MasterLabel: rec.MasterLabel || "",
          ProcessType: rec.ProcessType || "",
          Status: rec.Status || "",
          VersionNumber: rec.VersionNumber ?? "",
          LastModifiedDate: rec.LastModifiedDate || ""
        }));
        return textContent(rowList);
      } catch (exc) {
        return textContent({ error: exc?.message || String(exc) });
      }
    }
  );

  mcpServer.tool(
    "describe_flow_tooling_sobject",
    "Describe 指定 Tooling API 对象（如 Flow、FlowVersion、FlowDefinition、FlowInterview），返回字段元数据。apiName 仅允许字母数字下划线。只读。",
    {
      apiName: z
        .string()
        .describe("对象 API 名，如 Flow、FlowVersion、FlowDefinition")
    },
    async ({ apiName }) => {
      try {
        const trimmed = String(apiName).trim();
        if (!TOOLING_OBJ_NAME_RE.test(trimmed)) {
          return textContent({
            error: "apiName 仅允许字母、数字、下划线且以字母开头"
          });
        }
        const pathStr = `/tooling/sobjects/${trimmed}/describe`;
        const descBody = await sfRestGet(pathStr);
        return textContent({ objectApiName: trimmed, describe: descBody });
      } catch (exc) {
        return textContent({ error: exc?.message || String(exc) });
      }
    }
  );
}
