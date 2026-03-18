# SF MCP

在 Cursor 中为 AI 提供 Salesforce 的 MCP（Model Context Protocol）连接工具，让 AI 助手能够通过标准化接口访问 Salesforce 能力。

## 功能

- **MCP 服务**：在 Cursor 内启动 Salesforce MCP 服务，供 AI 调用
- **认证方式**：支持 **CLI**（基于已登录的 Salesforce CLI）或 **Token**（Instance URL + Access Token）
- **Org 选择**：可通过工作区 `.sf/config.json` 的 `target-org` 或扩展设置中的 Org 别名指定目标 Org
- **一键启动**：通过命令面板执行「Salesforce MCP: 启动服务」即可启动或重启服务

## 安装

### 从扩展市场安装

1. 在 Cursor / VS Code 中打开扩展视图（`Ctrl+Shift+X` / `Cmd+Shift+X`）
2. 搜索「SF MCP」或「Salesforce MCP」
3. 点击安装

### 从 VSIX 安装

1. 从 [Releases](https://github.com/lingu96111/sf-mcp/releases) 下载 `.vsix` 文件
2. 在扩展视图中点击「…」→「从 VSIX 安装…」，选择下载的 `.vsix`

## 配置

在设置中搜索「Salesforce MCP」可配置以下项：


| 配置项                           | 说明                                   | 默认值   |
| ----------------------------- | ------------------------------------ | ----- |
| `salesforceMcp.sfAuthMode`    | 认证模式：`cli` 或 `token`                 | `cli` |
| `salesforceMcp.sfOrgAlias`    | Org 别名（token 模式或覆盖 sf 配置时使用）         | 空     |
| `salesforceMcp.sfCliPath`     | Salesforce CLI 可执行文件路径（留空则从 PATH 查找） | 空     |
| `salesforceMcp.sfInstanceUrl` | Instance URL（仅 token 模式）             | 空     |
| `salesforceMcp.sfAccessToken` | Access Token（仅 token 模式）             | 空     |


- **CLI 模式**：需已在本机通过 `sf login` 登录，扩展会使用当前默认或指定 Org
- **Token 模式**：填写 `sfInstanceUrl` 与 `sfAccessToken`，可选填 `sfOrgAlias`

## 使用

1. 根据上述说明完成认证与 Org 配置
2. 按 `Ctrl+Shift+P`（或 `Cmd+Shift+P`）打开命令面板
3. 执行 **「Salesforce MCP: 启动服务」**
4. **在 Cursor 中启用 MCP 连接**：打开设置（`Ctrl+Shift+J` / `Cmd+Shift+J`）→ **Tools & MCP** → 勾选 **salesforce-mcp**（扩展写入的 MCP 默认可能未启用，需手动开启）
5. 状态栏会显示 MCP 是否就绪；输出通道「Salesforce MCP」可查看日志与 Org 别名等信息

## 要求

- **Cursor** 或 **VS Code** ^1.85.0
- **Node.js** >= 18
- CLI 模式下需已安装并登录 [Salesforce CLI](https://developer.salesforce.com/tools/sfcli)

## 许可证

MIT

## 链接

- [GitHub 仓库](https://github.com/lingu96111/sf-mcp)
- [开发者与构建说明](README_DEV.md)

