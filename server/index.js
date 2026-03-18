// MCP 服务入口；配置来自扩展写入的 env
import process from "node:process";

// 提高监听器上限，避免进程告警
if (process.setMaxListeners) {
  process.setMaxListeners(32);
}

// 忽略 punycode 弃用警告，避免刷屏
process.on("warning", (w) => {
  if (
    w.name === "DeprecationWarning" &&
    typeof w.message === "string" &&
    w.message.includes("punycode")
  ) {
    return;
  }
  console.warn(w);
});

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MCP_APP_NAME } from "./config.js";
import { registerToolsQuery } from "./tools/query.js";
import { registerToolsMetadata } from "./tools/metadata.js";
import { registerToolsApex } from "./tools/apex.js";
import { registerToolsUserSecurity } from "./tools/userSecurity.js";

// 创建 MCP 服务实例
const mcpServer = new McpServer(
  { name: MCP_APP_NAME, version: "1.0.0" },
  { capabilities: {} }
);

// 注册各工具模块
registerToolsQuery(mcpServer);
registerToolsMetadata(mcpServer);
registerToolsApex(mcpServer);
registerToolsUserSecurity(mcpServer);

// 使用 stdio 传输并连接
async function main() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

main().catch((err) => {
  console.error("Salesforce MCP server error:", err);
  process.exit(1);
});
