// 将 Salesforce Flow VersionData（MDAPI XML）解析为结构化对象
import { XMLParser } from "fast-xml-parser";

/** Tooling/MDAPI Flow 根下常见「可重复」子元素（用于 isArray 归一化） */
const FLOW_REPEAT_TAG_SET = new Set([
  "actionCalls",
  "apexPluginCalls",
  "assignments",
  "choices",
  "collectionProcessors",
  "customErrors",
  "decisions",
  "dynamicChoiceSets",
  "loops",
  "orchestratedStages",
  "processMetadataValues",
  "recordCreates",
  "recordDeletes",
  "recordLookups",
  "recordRollbacks",
  "recordUpdates",
  "screens",
  "stages",
  "subflows",
  "textTemplates",
  "variables",
  "constants",
  "formulas",
  "waits",
  "transforms",
  "customProperties",
  "emails"
]);

/** 纳入 elementIndex 的顶层分类 */
const FLOW_ELEM_CATEGORY_SET = new Set([...FLOW_REPEAT_TAG_SET]);

function ensureItemList(val) {
  if (val == null) return [];
  return Array.isArray(val) ? val : [val];
}

// 递归收集 targetReference
function collectTargetRefList(node) {
  const refSet = new Set();
  function walk(n) {
    if (n == null) return;
    if (Array.isArray(n)) {
      for (const x of n) walk(x);
      return;
    }
    if (typeof n !== "object") return;
    for (const [k, v] of Object.entries(n)) {
      if (k === "targetReference" && typeof v === "string" && v.trim()) {
        refSet.add(v.trim());
      } else if (v != null && typeof v === "object") walk(v);
    }
  }
  walk(node);
  return [...refSet];
}

// 从 Flow 根对象提取标量头信息
function pickHeaderScalarMap(rootObj) {
  const keyList = [
    "apiVersion",
    "description",
    "environments",
    "interviewLabel",
    "label",
    "processType",
    "runInMode",
    "status",
    "experienceConfiguration",
    "sourceTemplate",
    "timeZoneSidKey",
    "type" // 少数模板带 type
  ];
  const outMap = {};
  for (const k of keyList) {
    const v = rootObj[k];
    if (v !== undefined && v !== null && typeof v !== "object") {
      outMap[k] = v;
    }
  }
  return outMap;
}

// 为 AI 建立扁平元素索引（含完整 detail）
function buildElemIndexList(rootObj, maxCount) {
  const indexList = [];
  for (const cat of FLOW_ELEM_CATEGORY_SET) {
    if (!(cat in rootObj)) continue;
    const itemList = ensureItemList(rootObj[cat]);
    let idx = 0;
    for (const item of itemList) {
      if (indexList.length >= maxCount) return { indexList, truncated: true };
      const nameVal =
        item && typeof item === "object"
          ? item.name || item.developerName || ""
          : "";
      const labelVal =
        item && typeof item === "object" ? item.label || "" : "";
      indexList.push({
        category: cat,
        index: idx,
        name: String(nameVal),
        label: String(labelVal),
        connectorTargetList: collectTargetRefList(item),
        topLevelKeyList:
          item && typeof item === "object" ? Object.keys(item) : [],
        detail: item
      });
      idx += 1;
    }
  }
  return { indexList, truncated: false };
}

function maybeTruncateDetailJson(elemRow, maxChars) {
  let detailStr;
  try {
    detailStr = JSON.stringify(elemRow.detail);
  } catch (_) {
    return {
      category: elemRow.category,
      index: elemRow.index,
      name: elemRow.name,
      label: elemRow.label,
      connectorTargetList: elemRow.connectorTargetList,
      topLevelKeyList: elemRow.topLevelKeyList,
      detailStringifyError: true
    };
  }
  if (detailStr.length <= maxChars) return elemRow;
  return {
    category: elemRow.category,
    index: elemRow.index,
    name: elemRow.name,
    label: elemRow.label,
    connectorTargetList: elemRow.connectorTargetList,
    topLevelKeyList: elemRow.topLevelKeyList,
    detailTruncated: true,
    detailJsonCharLen: detailStr.length,
    detailPreviewJson: `${detailStr.slice(0, maxChars)}\n…(truncated)`
  };
}

function buildConnectorEdgeList(startObj, elemIndexList) {
  const edgeList = [];
  const fromStartList = collectTargetRefList(startObj);
  for (const t of fromStartList) {
    edgeList.push({ from: "(start)", to: t });
  }
  for (const row of elemIndexList) {
    const fromLabel =
      row.name || `${row.category}[${row.index}]`;
    for (const t of row.connectorTargetList || []) {
      edgeList.push({ from: fromLabel, to: t });
    }
  }
  return edgeList;
}

/**
 * 将 VersionData XML 解析为完整结构
 * @param {string} xmlStr
 * @param {object} optMap
 * @param {boolean} [optMap.includeFullTree]
 * @param {number} [optMap.fullTreeMaxChars]
 * @param {number} [optMap.maxElemDetailChars]
 * @param {number} [optMap.maxIndexedElements]
 */
export function parseFlowStructFromXml(xmlStr, optMap = {}) {
  const includeFullTree = Boolean(optMap.includeFullTree);
  const fullTreeMaxChars = Math.min(
    Math.max(Number(optMap.fullTreeMaxChars) || 150000, 5000),
    2_000_000
  );
  const maxElemDetailChars = Math.min(
    Math.max(Number(optMap.maxElemDetailChars) || 40000, 2000),
    500_000
  );
  const maxIndexedElements = limitIdxCap(optMap.maxIndexedElements, 800);

  if (!xmlStr || typeof xmlStr !== "string") {
    return { ok: false, errorMsg: "VersionData 为空或非字符串" };
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
    parseTagValue: true,
    parseTrueNumberOnly: false,
    isArray: (tagName) => FLOW_REPEAT_TAG_SET.has(tagName)
  });

  let treeRoot;
  try {
    treeRoot = parser.parse(xmlStr);
  } catch (err) {
    return {
      ok: false,
      errorMsg: err?.message ? String(err.message) : String(err)
    };
  }

  const rootKeyStr = Object.keys(treeRoot)[0];
  const flowBody = treeRoot[rootKeyStr];
  if (!flowBody || typeof flowBody !== "object") {
    return { ok: false, errorMsg: "根节点非对象，无法解析" };
  }

  const headerMap = pickHeaderScalarMap(flowBody);
  const startObj = flowBody.start ?? null;
  const varList = ensureItemList(flowBody.variables);
  const constList = ensureItemList(flowBody.constants);
  const formulaList = ensureItemList(flowBody.formulas);
  const choiceList = ensureItemList(flowBody.choices);
  const textTplList = ensureItemList(flowBody.textTemplates);

  const { indexList: rawIndexList, truncated: indexTrunc } =
    buildElemIndexList(flowBody, maxIndexedElements);

  const elemIndexList = rawIndexList.map((row) =>
    maybeTruncateDetailJson(row, maxElemDetailChars)
  );

  const startConnList = collectTargetRefList(startObj);
  const edgeList = buildConnectorEdgeList(startObj, rawIndexList);

  let fullTreeJsonStr;
  if (includeFullTree) {
    try {
      fullTreeJsonStr = JSON.stringify(treeRoot);
      if (fullTreeJsonStr.length > fullTreeMaxChars) {
        fullTreeJsonStr = `${fullTreeJsonStr.slice(0, fullTreeMaxChars)}\n…(truncated)`;
      }
    } catch (_) {
      fullTreeJsonStr = "{\"_error\":\"full_tree_stringify_failed\"}";
    }
  }

  const elemCountMap = {};
  for (const cat of FLOW_REPEAT_TAG_SET) {
    if (flowBody[cat] == null) continue;
    elemCountMap[cat] = ensureItemList(flowBody[cat]).length;
  }

  return {
    ok: true,
    rootTag: rootKeyStr,
    headerMap,
    start: startObj,
    startConnectorTargetList: startConnList,
    variables: varList,
    constants: constList,
    formulas: formulaList,
    choices: choiceList,
    textTemplates: textTplList,
    elementIndex: elemIndexList,
    connectorEdgeList: edgeList,
    elementCountMap: elemCountMap,
    statistics: {
      xmlCharLen: xmlStr.length,
      indexedElementCount: elemIndexList.length,
      indexTruncated: indexTrunc,
      elementCategoriesPresentList: Object.keys(elemCountMap).filter(
        (k) => elemCountMap[k] > 0
      )
    },
    fullTreeJson: fullTreeJsonStr,
    parseNote:
      "由 fast-xml-parser 将 MDAPI Flow XML 转为 JSON；异常 Flow 请以 Builder 与 get_flow_version_data 原文核对。"
  };
}

function limitIdxCap(n, cap) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 1) return 400;
  return Math.min(Math.floor(x), cap);
}
