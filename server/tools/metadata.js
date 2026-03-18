// 元数据与对象配置类工具（对象、字段、布局、验证规则等）
import { z } from "zod";
import {
  sfDescribeObject,
  sfGetObjectRecord,
  sfQueryAll,
  sfRestGet,
  sfToolingQuery,
  withReauth,
  escapeSoqlLiteral,
  validatePathParam,
  OBJECT_LAYOUT_PATH_TEMPLATE,
  COMPACT_LAYOUT_PATH_TEMPLATE
} from "../core/connection.js";
import { textContent } from "../core/utils.js";

export function registerToolsMetadata(mcpServer) {
  // 取对象字段名、标签、类型、长度
  mcpServer.tool(
    "get_object_fields",
    "查询指定对象的字段信息：API 名称、标签、类型、长度（只读）。",
    { objName: z.string().describe("对象 API 名称") },
    async ({ objName }) => {
      const desc = await sfDescribeObject(objName);
      const fieldList = (desc.fields || []).map((f) => ({
        name: f.name,
        label: f.label,
        type: f.type,
        length: String(f.length ?? "")
      }));
      return textContent(fieldList);
    }
  );

  // 按对象名与记录 Id 取单条记录，去掉 attributes
  mcpServer.tool(
    "get_record",
    "按对象名和记录 Id 查询单条记录（只读）。",
    {
      objName: z.string(),
      recordId: z.string()
    },
    async ({ objName, recordId }) => {
      validatePathParam(objName, "objName");
      validatePathParam(recordId, "recordId");
      const rec = await sfGetObjectRecord(objName, recordId);
      const out = {};
      for (const [k, v] of Object.entries(rec)) {
        if (k !== "attributes") out[k] = v;
      }
      return textContent(out);
    }
  );

  // 取可查询对象名列表并排序
  mcpServer.tool(
    "list_objects",
    "查询当前 Org 中所有可通过 SOQL 查询的对象 API 名称列表（只读）。",
    {},
    async () => {
      const desc = await withReauth((conn) => conn.describe());
      const nameList = (desc.sobjects || [])
        .filter((obj) => obj.queryable)
        .map((obj) => obj.name);
      nameList.sort();
      return textContent(nameList);
    }
  );

  // 查 RecordType，objName 转义后拼 SOQL
  mcpServer.tool(
    "get_record_types",
    "查询指定对象的所有 RecordType：Id、DeveloperName、Name、是否激活（只读）。",
    { objName: z.string() },
    async ({ objName }) => {
      const safeObj = escapeSoqlLiteral(objName);
      const soql = `SELECT Id, DeveloperName, Name, IsActive FROM RecordType WHERE SobjectType = '${safeObj}' ORDER BY DeveloperName`;
      const resultData = await sfQueryAll(soql);
      const rtList = (resultData.records || []).map((rec) => ({
        Id: rec.Id,
        DeveloperName: rec.DeveloperName,
        Name: rec.Name,
        IsActive: String(rec.IsActive)
      }));
      return textContent(rtList);
    }
  );

  // 返回完整 describe
  mcpServer.tool(
    "describe_object",
    "查询指定对象的完整 describe 信息（只读）。",
    { objName: z.string() },
    async ({ objName }) => {
      const desc = await sfDescribeObject(objName);
      return textContent(desc);
    }
  );

  // 取页面布局，从 editLayoutSections 抽字段名
  mcpServer.tool(
    "get_object_layout",
    "查询指定对象的页面布局摘要，返回各布局包含的字段列表（只读）。",
    { objName: z.string() },
    async ({ objName }) => {
      const safeObj = validatePathParam(objName, "objName");
      const layoutPath = OBJECT_LAYOUT_PATH_TEMPLATE.replace("{objName}", safeObj);
      const desc = await sfRestGet(layoutPath);
      const layoutList = (desc.layouts || []).map((layout) => {
        const fieldNameList = [];
        for (const section of layout.editLayoutSections || []) {
          for (const row of section.layoutRows || []) {
            for (const item of row.layoutItems || []) {
              for (const comp of item.layoutComponents || []) {
                const fname = comp.value;
                if (fname) fieldNameList.push(fname);
              }
            }
          }
        }
        return { layoutId: layout.id || "", fieldNameList };
      });
      return textContent(layoutList);
    }
  );

  // 取子关系列表并排序
  mcpServer.tool(
    "get_child_relations",
    "查询指定对象的所有子关系（相关列表）：子对象名、关系名、外键字段（只读）。",
    { objName: z.string() },
    async ({ objName }) => {
      const desc = await sfDescribeObject(objName);
      const relList = (desc.childRelationships || []).map((cr) => ({
        childSObject: cr.childSObject || "",
        relationName: cr.relationshipName || "",
        field: cr.field || ""
      }));
      relList.sort((a, b) => a.childSObject.localeCompare(b.childSObject));
      return textContent(relList);
    }
  );

  // 从 describe 中取指定字段的 picklist 值
  mcpServer.tool(
    "get_picklist_values",
    "查询指定对象某个 Picklist 字段的所有可选值（只读）。",
    {
      objName: z.string(),
      fieldName: z.string()
    },
    async ({ objName, fieldName }) => {
      const desc = await sfDescribeObject(objName);
      for (const f of desc.fields || []) {
        if (f.name === fieldName) {
          const valList = (f.picklistValues || []).map((pv) => ({
            label: pv.label || "",
            value: pv.value || "",
            isDefault: pv.defaultValue || false,
            isActive: pv.active !== false
          }));
          return textContent(valList);
        }
      }
      return textContent([{ error: `Field '${fieldName}' not found on ${objName}` }]);
    }
  );

  // Tooling 查 ValidationRule，再请求详情取公式
  mcpServer.tool(
    "get_validation_rules",
    "查询指定对象上所有验证规则：名称、是否激活、错误条件公式、错误消息（只读）。",
    { objName: z.string() },
    async ({ objName }) => {
      const safeObj = escapeSoqlLiteral(objName);
      const soql = `SELECT Id, ValidationName, Active, ErrorDisplayField, ErrorMessage FROM ValidationRule WHERE EntityDefinition.QualifiedApiName = '${safeObj}'`;
      const resultData = await sfToolingQuery(soql);
      const ruleList = [];
      for (const rec of resultData.records || []) {
        let formula = "";
        const ruleId = rec.Id;
        if (ruleId) {
          try {
            const detailData = await withReauth((conn) =>
              conn.request({
                method: "GET",
                url: `/tooling/sobjects/ValidationRule/${ruleId}`
              })
            );
            formula = detailData.Metadata?.errorConditionFormula || "";
          } catch (_) {}
        }
        ruleList.push({
          Id: ruleId,
          name: rec.ValidationName,
          isActive: rec.Active,
          errorField: rec.ErrorDisplayField || "",
          errorMessage: rec.ErrorMessage || "",
          formula
        });
      }
      return textContent(ruleList);
    }
  );

  // 取紧凑布局及字段列表
  mcpServer.tool(
    "get_compact_layouts",
    "查询指定对象的紧凑布局：布局 Id、名称、字段列表（只读）。",
    { objName: z.string() },
    async ({ objName }) => {
      const safeObj = validatePathParam(objName, "objName");
      const compactPath = COMPACT_LAYOUT_PATH_TEMPLATE.replace("{objName}", safeObj);
      const desc = await sfRestGet(compactPath);
      const layoutList = (desc.compactLayouts || []).map((layout) => {
        const fieldNameList = (layout.fieldItems || [])
          .map((item) => item.fieldName)
          .filter(Boolean);
        return {
          layoutId: layout.id || "",
          name: layout.label || "",
          fieldNameList
        };
      });
      return textContent(layoutList);
    }
  );

  // Tooling 查 FlexiPage RecordPage
  mcpServer.tool(
    "get_lightning_pages_for_object",
    "查询与指定对象相关的 Lightning Record Page（只读）。",
    { objName: z.string() },
    async ({ objName }) => {
      const safeObj = escapeSoqlLiteral(objName);
      const soql = `SELECT Id, MasterLabel, Type FROM FlexiPage WHERE Type = 'RecordPage' AND EntityDefinition.QualifiedApiName = '${safeObj}'`;
      try {
        const resultData = await sfToolingQuery(soql);
        const pageList = (resultData.records || []).map((rec) => ({
          Id: rec.Id || "",
          MasterLabel: rec.MasterLabel || "",
          Type: rec.Type || ""
        }));
        return textContent({ objectName: objName, recordPages: pageList });
      } catch (exc) {
        const errMsg = (exc && exc.message) ? exc.message : String(exc);
        return textContent({ error: `FlexiPage query failed: ${errMsg}` });
      }
    }
  );

  // 汇总 describe/规则/Trigger/Flow/布局
  mcpServer.tool(
    "get_object_config_overview",
    "汇总指定对象的配置概览（只读）：describe、验证规则、Trigger、Flow、Workflow、紧凑布局等。",
    { objName: z.string() },
    async ({ objName }) => {
      validatePathParam(objName, "objName");
      const { getTriggersForObject, getFlowsForObject, getWorkflowsForObject } =
        await import("./apex.js");
      const resultData = { objectName: objName, success: true };

      try {
        resultData.describe = await sfDescribeObject(objName);
      } catch (exc) {
        resultData.success = false;
        resultData.describeError = String(exc);
      }

      try {
        const ruleList = await (async () => {
          const safeObj = escapeSoqlLiteral(objName);
          const soql = `SELECT Id, ValidationName, Active, ErrorDisplayField, ErrorMessage FROM ValidationRule WHERE EntityDefinition.QualifiedApiName = '${safeObj}'`;
          const resultDataInner = await sfToolingQuery(soql);
          return (resultDataInner.records || []).map((rec) => ({
            Id: rec.Id,
            name: rec.ValidationName,
            isActive: rec.Active,
            errorField: rec.ErrorDisplayField || "",
            errorMessage: rec.ErrorMessage || "",
            formula: ""
          }));
        })();
        resultData.validationRules = ruleList;
      } catch (exc) {
        resultData.success = false;
        resultData.validationRulesError = String(exc);
      }

      try {
        resultData.triggers = await getTriggersForObject(objName);
      } catch (exc) {
        resultData.success = false;
        resultData.triggersError = String(exc);
      }

      try {
        resultData.flows = await getFlowsForObject(objName);
      } catch (exc) {
        resultData.success = false;
        resultData.flowsError = String(exc);
      }

      try {
        resultData.workflows = await getWorkflowsForObject(objName);
      } catch (exc) {
        resultData.success = false;
        resultData.workflowsError = String(exc);
      }

      try {
        const compactPath = COMPACT_LAYOUT_PATH_TEMPLATE.replace("{objName}", objName);
        const desc = await sfRestGet(compactPath);
        resultData.compactLayouts = (desc.compactLayouts || []).map((layout) => ({
          layoutId: layout.id || "",
          name: layout.label || "",
          fieldNameList: (layout.fieldItems || []).map((i) => i.fieldName).filter(Boolean)
        }));
      } catch (exc) {
        resultData.success = false;
        resultData.compactLayoutsError = String(exc);
      }

      return textContent(resultData);
    }
  );
}
