// 查询与 API 类工具：SOQL / SOSL / Tooling / REST / Limits / API 使用量
import { z } from "zod";
import {
  sfQueryAll,
  sfToolingQuery,
  sfRestGet,
  limitValue,
  withReauth,
  DEFAULT_API_USAGE_MAX_HOURS
} from "../core/connection.js";
import { textContent } from "../core/utils.js";

export function registerToolsQuery(mcpServer) {
  // 执行 SOQL，返回记录列表
  mcpServer.tool(
    "run_soql",
    "执行 SOQL 查询，返回记录列表（只读查询，不做任何修改）。",
    { query: z.string().describe("SOQL 查询语句") },
    async ({ query }) => {
      const resultData = await sfQueryAll(query);
      const records = resultData.records || [];
      return textContent(records);
    }
  );

  // 执行 SOSL 搜索，返回 searchRecords
  mcpServer.tool(
    "run_sosl",
    "执行 SOSL 搜索，返回匹配记录列表（只读查询，不做任何修改）。",
    { search: z.string().describe("SOSL 搜索语句") },
    async ({ search }) => {
      const resultData = await withReauth((conn) => conn.search(search));
      const list = resultData.searchRecords || [];
      return textContent(list);
    }
  );

  // Tooling SOQL，用于元数据查询
  mcpServer.tool(
    "run_tooling_query",
    "执行 Tooling API SOQL 查询（用于查 ApexClass、ApexTrigger、ValidationRule 等元数据，只读）。",
    { query: z.string().describe("Tooling SOQL 查询") },
    async ({ query }) => {
      const resultData = await sfToolingQuery(query);
      const records = resultData.records || [];
      return textContent(records);
    }
  );

  // 任意 REST GET，path 为相对路径
  mcpServer.tool(
    "rest_get",
    "对 Salesforce REST API 发起任意 GET 请求（只读）。path 是 /services/data/vXX.0/ 之后的相对路径。",
    { path: z.string().describe("API 相对路径") },
    async ({ path }) => {
      const data = await sfRestGet(path);
      return textContent(data);
    }
  );

  // 取当前 Org API 限额与使用量
  mcpServer.tool(
    "get_org_limits",
    "查询当前 Org 的 API 调用限额和使用量（只读查询）。",
    {},
    async () => {
      const limits = await withReauth((conn) => conn.limits());
      return textContent(limits);
    }
  );

  // 按小时数查 EventLogFile 中 API 事件
  mcpServer.tool(
    "get_recent_api_usage",
    "查询最近一段时间内的 API 使用情况（只读）。依赖 EventLogFile 对象。",
    { hours: z.number().optional().default(24).describe("小时数") },
    async ({ hours }) => {
      const safeHours = limitValue(hours, DEFAULT_API_USAGE_MAX_HOURS);
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - safeHours * 3600 * 1000);
      const startStr = startTime.toISOString().replace(/\.\d{3}Z$/, ".000Z");
      const soql = `SELECT Id, EventType, LogDate, LogFileLength FROM EventLogFile WHERE EventType = 'API' AND LogDate >= ${startStr} ORDER BY LogDate DESC LIMIT 200`;
      try {
        const resultData = await sfQueryAll(soql);
        const eventList = (resultData.records || []).map((rec) => ({
          Id: rec.Id || "",
          EventType: rec.EventType || "",
          LogDate: rec.LogDate || "",
          LogFileLength: rec.LogFileLength ?? 0
        }));
        return textContent({ hours: safeHours, events: eventList });
      } catch (exc) {
        const errMsg = (exc && exc.message) ? exc.message : String(exc);
        return textContent({
          error: `EventLogFile query failed: ${errMsg}`
        });
      }
    }
  );
}
