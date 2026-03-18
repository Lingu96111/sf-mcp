// Apex / Trigger / Flow / Workflow 工具；导出三函数供 metadata 用
import { z } from "zod";
import {
  sfQueryAll,
  sfRestGet,
  sfToolingQuery,
  limitValue,
  escapeSoqlLiteral,
  validatePathParam,
  APEX_LOG_BODY_PATH_TEMPLATE,
  DEFAULT_LOG_LIMIT,
  DEFAULT_LIMIT_MAX
} from "../core/connection.js";
import { textContent } from "../core/utils.js";

// 按对象查 ApexTrigger，供 overview 用
export async function getTriggersForObject(objName) {
  const safeObj = escapeSoqlLiteral(objName);
  const soql = `SELECT Id, Name, TableEnumOrId, ApiVersion, Status, UsageBeforeInsert, UsageBeforeUpdate, UsageBeforeDelete, UsageAfterInsert, UsageAfterUpdate, UsageAfterDelete, UsageAfterUndelete, LastModifiedDate FROM ApexTrigger WHERE TableEnumOrId = '${safeObj}' ORDER BY Name`;
  const resultData = await sfToolingQuery(soql);
  return (resultData.records || []).map((rec) => ({
    Id: rec.Id || "",
    Name: rec.Name || "",
    TableEnumOrId: rec.TableEnumOrId || "",
    ApiVersion: rec.ApiVersion || "",
    Status: rec.Status || "",
    UsageBeforeInsert: rec.UsageBeforeInsert || false,
    UsageBeforeUpdate: rec.UsageBeforeUpdate || false,
    UsageBeforeDelete: rec.UsageBeforeDelete || false,
    UsageAfterInsert: rec.UsageAfterInsert || false,
    UsageAfterUpdate: rec.UsageAfterUpdate || false,
    UsageAfterDelete: rec.UsageAfterDelete || false,
    UsageAfterUndelete: rec.UsageAfterUndelete || false,
    LastModifiedDate: rec.LastModifiedDate || ""
  }));
}

// 按对象查 Flow（Record-Triggered）
export async function getFlowsForObject(objName) {
  const safeObj = escapeSoqlLiteral(objName);
  const soql = `SELECT Id, MasterLabel, ProcessType, TriggerType, TriggerObject, Status, VersionNumber, LastModifiedDate FROM Flow WHERE TriggerObject = '${safeObj}' AND ProcessType = 'Flow' ORDER BY LastModifiedDate DESC`;
  const resultData = await sfToolingQuery(soql);
  return (resultData.records || []).map((rec) => ({
    Id: rec.Id || "",
    MasterLabel: rec.MasterLabel || "",
    ProcessType: rec.ProcessType || "",
    TriggerType: rec.TriggerType || "",
    TriggerObject: rec.TriggerObject || "",
    Status: rec.Status || "",
    VersionNumber: rec.VersionNumber || "",
    LastModifiedDate: rec.LastModifiedDate || ""
  }));
}

// 按对象查 WorkflowRule
export async function getWorkflowsForObject(objName) {
  const safeObj = escapeSoqlLiteral(objName);
  const soql = `SELECT Id, Name, TableEnumOrId, Active, Description FROM WorkflowRule WHERE TableEnumOrId = '${safeObj}' ORDER BY Name`;
  const resultData = await sfToolingQuery(soql);
  return (resultData.records || []).map((rec) => ({
    Id: rec.Id || "",
    Name: rec.Name || "",
    TableEnumOrId: rec.TableEnumOrId || "",
    Active: rec.Active || false,
    Description: rec.Description || ""
  }));
}

export function registerToolsApex(mcpServer) {
  // ApexLog 列表，条数限制
  mcpServer.tool(
    "get_apex_logs",
    "查询最近的 Apex 调试日志列表（只读）。默认 10 条，最多 50 条。",
    { maxCount: z.number().optional().default(10) },
    async ({ maxCount }) => {
      const limitVal = limitValue(maxCount, DEFAULT_LOG_LIMIT);
      const soql = `SELECT Id, LogUser.Name, Operation, Status, LogLength, StartTime, DurationMilliseconds FROM ApexLog ORDER BY StartTime DESC LIMIT ${limitVal}`;
      const resultData = await sfQueryAll(soql);
      const logList = (resultData.records || []).map((rec) => ({
        Id: rec.Id,
        User: rec.LogUser?.Name || "",
        Operation: rec.Operation || "",
        Status: rec.Status || "",
        LogLength: String(rec.LogLength ?? ""),
        StartTime: rec.StartTime || "",
        Duration_ms: String(rec.DurationMilliseconds ?? "")
      }));
      return textContent(logList);
    }
  );
  // 按 logId 取日志 Body
  mcpServer.tool(
    "get_apex_log_body",
    "根据日志 Id 获取 Apex 调试日志的完整内容（只读）。",
    { logId: z.string() },
    async ({ logId }) => {
      const safeLogId = validatePathParam(logId, "logId");
      const pathStr = APEX_LOG_BODY_PATH_TEMPLATE.replace("{logId}", safeLogId);
      const body = await sfRestGet(pathStr);
      return textContent(
        typeof body === "string" ? body : JSON.stringify(body)
      );
    }
  );
  // ApexClass 按类名取 Body 与元数据
  mcpServer.tool(
    "get_apex_source",
    "查询指定 Apex 类在 Org 中的源代码和最后修改时间（只读）。",
    { className: z.string() },
    async ({ className }) => {
      const safeName = escapeSoqlLiteral(className);
      const soql = `SELECT Id, Name, Body, LastModifiedDate, LastModifiedBy.Name, ApiVersion FROM ApexClass WHERE Name = '${safeName}'`;
      const resultData = await sfToolingQuery(soql);
      const recordList = resultData.records || [];
      if (recordList.length === 0) {
        return textContent({ error: `ApexClass '${className}' not found in Org` });
      }
      const rec = recordList[0];
      const modBy = rec.LastModifiedBy || {};
      return textContent({
        Id: rec.Id || "",
        Name: rec.Name || "",
        ApiVersion: rec.ApiVersion || "",
        LastModifiedDate: rec.LastModifiedDate || "",
        LastModifiedBy: modBy.Name || "",
        Body: rec.Body || ""
      });
    }
  );
  // 暴露 getTriggersForObject
  mcpServer.tool(
    "get_triggers_for_object",
    "查询指定对象上的 Apex Trigger 列表（只读）。",
    { objName: z.string() },
    async ({ objName }) => {
      const list = await getTriggersForObject(objName);
      return textContent(list);
    }
  );
  // 暴露 getFlowsForObject
  mcpServer.tool(
    "get_flows_for_object",
    "查询与指定对象相关的 Record-Triggered Flow（只读）。",
    { objName: z.string() },
    async ({ objName }) => {
      const list = await getFlowsForObject(objName);
      return textContent(list);
    }
  );
  // 暴露 getWorkflowsForObject
  mcpServer.tool(
    "get_workflows_for_object",
    "查询指定对象上的 Workflow Rule 列表（只读）。",
    { objName: z.string() },
    async ({ objName }) => {
      const list = await getWorkflowsForObject(objName);
      return textContent(list);
    }
  );
  // ApexClass 列表，可选 nameLike 与 limit
  mcpServer.tool(
    "list_apex_classes",
    "查询 ApexClass 列表（只读）。支持名称模糊匹配与条数限制。",
    {
      nameLike: z.string().optional(),
      limit: z.number().optional().default(100)
    },
    async ({ nameLike, limit }) => {
      const safeLimit = limitValue(limit, DEFAULT_LIMIT_MAX);
      let whereSql = "";
      if (nameLike) {
        const safeLike = escapeSoqlLiteral(nameLike);
        whereSql = `WHERE Name LIKE '%${safeLike}%'`;
      }
      const soql = `SELECT Id, Name, ApiVersion, Status, LastModifiedDate FROM ApexClass ${whereSql} ORDER BY LastModifiedDate DESC LIMIT ${safeLimit}`;
      const resultData = await sfToolingQuery(soql);
      const classList = (resultData.records || []).map((rec) => ({
        Id: rec.Id || "",
        Name: rec.Name || "",
        ApiVersion: rec.ApiVersion || "",
        Status: rec.Status || "",
        LastModifiedDate: rec.LastModifiedDate || ""
      }));
      return textContent(classList);
    }
  );
  // ApexTrigger 列表，可选 nameLike 与 limit
  mcpServer.tool(
    "list_apex_triggers",
    "查询 ApexTrigger 列表（只读）。支持名称模糊匹配与条数限制。",
    {
      nameLike: z.string().optional(),
      limit: z.number().optional().default(100)
    },
    async ({ nameLike, limit }) => {
      const safeLimit = limitValue(limit, DEFAULT_LIMIT_MAX);
      let whereSql = "";
      if (nameLike) {
        const safeLike = escapeSoqlLiteral(nameLike);
        whereSql = `WHERE Name LIKE '%${safeLike}%'`;
      }
      const soql = `SELECT Id, Name, TableEnumOrId, ApiVersion, Status, LastModifiedDate FROM ApexTrigger ${whereSql} ORDER BY LastModifiedDate DESC LIMIT ${safeLimit}`;
      const resultData = await sfToolingQuery(soql);
      const triggerList = (resultData.records || []).map((rec) => ({
        Id: rec.Id || "",
        Name: rec.Name || "",
        TableEnumOrId: rec.TableEnumOrId || "",
        ApiVersion: rec.ApiVersion || "",
        Status: rec.Status || "",
        LastModifiedDate: rec.LastModifiedDate || ""
      }));
      return textContent(triggerList);
    }
  );
  // Body LIKE 查引用该类的测试类
  mcpServer.tool(
    "get_apex_tests_for_class",
    "查询可能引用指定业务类的测试类（只读，通过 Body LIKE 弱引用搜索）。",
    { className: z.string() },
    async ({ className }) => {
      const safeName = escapeSoqlLiteral(className);
      const soql = `SELECT Id, Name, ApiVersion, Status, LastModifiedDate FROM ApexClass WHERE Name LIKE '%Test%' AND Body LIKE '%${safeName}%' ORDER BY LastModifiedDate DESC`;
      const resultData = await sfToolingQuery(soql);
      const testClassList = (resultData.records || []).map((rec) => ({
        Id: rec.Id || "",
        Name: rec.Name || "",
        ApiVersion: rec.ApiVersion || "",
        Status: rec.Status || "",
        LastModifiedDate: rec.LastModifiedDate || ""
      }));
      return textContent(testClassList);
    }
  );
}
