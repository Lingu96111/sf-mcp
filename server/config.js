// 从 process.env 读取 SF 配置，由扩展注入

// 日志名与 MCP 应用名，可被 env 覆盖
export const LOG_NAME = process.env.SF_MCP_LOG_NAME || "sf-mcp";
export const MCP_APP_NAME = process.env.SF_MCP_APP_NAME || "Salesforce MCP";

// 环境变量键名常量
export const ENV_SF_ORG_ALIAS = "SF_ORG_ALIAS";
export const ENV_SF_CLI_PATH = "SF_CLI_PATH";
export const ENV_SF_INSTANCE_URL = "SF_INSTANCE_URL";
export const ENV_SF_ACCESS_TOKEN = "SF_ACCESS_TOKEN";
export const ENV_SF_AUTH_MODE = "SF_AUTH_MODE";

// 认证模式枚举与默认 CLI 路径
export const AUTH_MODE_CLI = "cli";
export const AUTH_MODE_TOKEN = "token";
export const DEFAULT_SF_CLI_PATH = "sf";

// 日志级别名到数值的映射
const levelMap = {
  DEBUG: 10,
  INFO: 20,
  WARNING: 30,
  ERROR: 40,
  CRITICAL: 50
};

// 从 env 取日志级别，默认 INFO
export function getLogLevel() {
  const levelName = (process.env.SF_LOG_LEVEL || "INFO").toUpperCase();
  return levelMap[levelName] ?? 20;
}

// 取认证模式，默认 cli
export function getAuthMode() {
  return process.env[ENV_SF_AUTH_MODE] || AUTH_MODE_CLI;
}

// 取 Org 别名，空表示用 CLI 默认
export function getOrgAlias() {
  return process.env[ENV_SF_ORG_ALIAS] || "";
}

// 取 CLI 可执行路径
export function getCliPath() {
  return process.env[ENV_SF_CLI_PATH] || DEFAULT_SF_CLI_PATH;
}

// 取 Instance URL（token 模式用）
export function getInstanceUrl() {
  return process.env[ENV_SF_INSTANCE_URL] || "";
}

// 取 Access Token（token 模式用）
export function getAccessToken() {
  return process.env[ENV_SF_ACCESS_TOKEN] || "";
}
