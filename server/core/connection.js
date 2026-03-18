// SF 连接、认证与通用查询封装
import { spawnSync } from "node:child_process";
import jsforce from "jsforce";
import {
  getAuthMode,
  getOrgAlias,
  getCliPath,
  getInstanceUrl,
  getAccessToken,
  AUTH_MODE_CLI,
  AUTH_MODE_TOKEN
} from "../config.js";

// Tooling 查询 URL 前缀与各类默认限制、路径模板
export const TOOLING_QUERY_PREFIX = "query/?q=";
export const DEFAULT_LIMIT_MIN = 1;
export const DEFAULT_LIMIT_MAX = 200;
export const DEFAULT_LOG_LIMIT = 50;
export const DEFAULT_API_USAGE_MAX_HOURS = 168;
// 路径
export const CHATTER_ME_PATH = "/chatter/users/me";
export const APEX_LOG_BODY_PATH_TEMPLATE = "/sobjects/ApexLog/{logId}/Body";
export const OBJECT_LAYOUT_PATH_TEMPLATE = "/sobjects/{objName}/describe/layouts";
export const COMPACT_LAYOUT_PATH_TEMPLATE = "/sobjects/{objName}/describe/compactLayouts";

// 单例连接，懒创建
let sfConn = null;

// 将数值限制在 [minVal, maxVal] 内
export function limitValue(value, maxVal, minVal = DEFAULT_LIMIT_MIN) {
  const safeMin = Math.max(minVal, 1);
  const safeMax = Math.max(safeMin, maxVal);
  return Math.max(safeMin, Math.min(value, safeMax));
}

// 校验路径参数
export function validatePathParam(value, paramName = "pathParam") {
  const str = String(value);
  if (str.includes("..") || str.includes("/") || str.includes("\\")) {
    throw new Error(`Invalid ${paramName}: path traversal not allowed`);
  }
  return str;
}

// 转义 SOQL 字符串，防注入
export function escapeSoqlLiteral(rawValue) {
  return String(rawValue).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// 通过 CLI 获取 instanceUrl 与 accessToken
function authViaCli() {
  const aliasName = getOrgAlias();
  const sfPath = getCliPath();
  const args = ["org", "display", "--json"];
  if (aliasName) args.push("-o", aliasName);
  const result = spawnSync(sfPath, args, {
    encoding: "utf8",
    timeout: 30000,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true
  });
  const stdout = (result.stdout != null ? String(result.stdout) : "").trim();
  const stderr = result.stderr != null ? String(result.stderr).trim() : "";

  if (stdout.startsWith("{")) {
    let payload;
    try {
      payload = JSON.parse(stdout);
    } catch (_) {}
    const rd = payload && payload.result;
    if (rd && rd.instanceUrl && rd.accessToken) {
      return { instanceUrl: rd.instanceUrl, accessToken: rd.accessToken };
    }
    if (payload && payload.message) {
      throw new Error(payload.message);
    }
  }

  let msg = stderr || (result.error && result.error.message) || `退出码 ${result.status}`;
  if (/no default environment|target-org|specify an environment/i.test(msg)) {
    msg =
      "未指定目标 Org。请先用官方 Salesforce 插件连接 Org，或在扩展设置中填写「Salesforce MCP: Sf Org Alias」。";
  } else {
    msg = `SF CLI 执行失败: ${msg}`;
  }
  throw new Error(msg);
}

// 从 env 取 instanceUrl 与 accessToken（token 模式）
function authViaToken() {
  const instUrl = getInstanceUrl();
  const accessToken = getAccessToken();
  if (!instUrl || !accessToken) {
    throw new Error(
      `未在 Cursor 设置中配置 salesforceMcp.sfInstanceUrl 与 salesforceMcp.sfAccessToken`
    );
  }
  return { instanceUrl: instUrl, accessToken };
}

// 拒绝 lightning URL
function normalizeInstanceUrl(url) {
  const trimmed = String(url).trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("instanceUrl 为空，无法建立连接");
  }
  if (
    trimmed.includes(".lightning.force.com") ||
    trimmed.includes(".lightning.crmforce.mil") ||
    trimmed.includes(".lightning.sfcrmapps.cn")
  ) {
    throw new Error(
      "Lightning URL 不能作为 instanceUrl。请使用 instance URL（如 https://xxx.salesforce.com），可从「设置 > 公司信息」或 CLI 的 org display 获取。"
    );
  }
  if (!trimmed.startsWith("https://") && !trimmed.startsWith("http://")) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

// 按当前认证模式构建 jsforce 连接
function buildConnection() {
  const authMode = getAuthMode();
  let creds;
  if (authMode === AUTH_MODE_TOKEN) {
    creds = authViaToken();
  } else {
    creds = authViaCli();
  }
  const instanceUrl = normalizeInstanceUrl(creds.instanceUrl);
  return new jsforce.Connection({
    instanceUrl,
    accessToken: creds.accessToken
  });
}

// 获取单例连接，未建则创建
export function getSfConn() {
  if (!sfConn) {
    sfConn = buildConnection();
  }
  return sfConn;
}

// 重建连接并返回
export function refreshSfConn() {
  sfConn = buildConnection();
  return sfConn;
}

// 会话失效则重连并重试一次
export async function withReauth(opFn) {
  let conn = getSfConn();
  try {
    return await opFn(conn);
  } catch (err) {
    const msg = err?.message || String(err);
    if (
      msg.includes("INVALID_SESSION") ||
      msg.includes("401") ||
      msg.includes("Session expired")
    ) {
      refreshSfConn();
      conn = getSfConn();
      return await opFn(conn);
    }
    throw err;
  }
}

// 执行 SOQL 查询并返回结果
export async function sfQueryAll(soql) {
  return withReauth((conn) => conn.query(soql));
}

// 执行 Tooling API SOQL 查询
export async function sfToolingQuery(soql) {
  return withReauth((conn) =>
    conn.request({
      method: "GET",
      url: `/tooling/${TOOLING_QUERY_PREFIX}${encodeURIComponent(soql)}`
    })
  );
}

// 对 REST API 发起 GET 请求
export async function sfRestGet(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return withReauth((conn) =>
    conn.request({ method: "GET", url: normalizedPath })
  );
}

// 获取对象 describe
export async function sfDescribeObject(objName) {
  return withReauth((conn) => conn.sobject(objName).describe());
}

// 按对象名与记录 Id 取单条记录
export async function sfGetObjectRecord(objName, recordId) {
  return withReauth((conn) => conn.sobject(objName).retrieve(recordId));
}

// 递归去掉记录中的 attributes 字段
export function stripAttrs(recList) {
  if (!Array.isArray(recList)) return recList;
  return recList.map((rec) => {
    const cleaned = {};
    for (const [k, v] of Object.entries(rec)) {
      if (k === "attributes") continue;
      if (v && typeof v === "object" && Array.isArray(v.records)) {
        cleaned[k] = { ...v, records: stripAttrs(v.records) };
      } else {
        cleaned[k] = v;
      }
    }
    return cleaned;
  });
}
