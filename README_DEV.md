# SF MCP — 开发者与构建说明

本文档面向参与开发、构建或发布 SF MCP 扩展的开发者。用户使用说明请查看 [README.md](README.md)。

## 环境要求

- **Node.js** >= 18
- **pnpm**（推荐）或 npm
- **Salesforce CLI**（用于本地测试 CLI 认证）

## 克隆与安装

```bash
git clone https://github.com/lingu96111/sf-mcp.git
cd sf-mcp
pnpm install
pnpm run install:mcp
```

`install:mcp` 会安装 `server` 目录依赖并构建 MCP 服务产物 `server/dist/mcp.js`。

## 目录结构

```
sf-mcp/
├── src/
│   └── extension.js    # 扩展入口：启动/停止 MCP、配置与状态栏
├── server/
│   ├── index.js        # MCP 服务入口，被打包进 dist/mcp.js
│   ├── dist/
│   │   └── mcp.js      # esbuild 打包后的 MCP 服务
│   └── package.json    # MCP 侧依赖
├── images/             # 图标等资源
├── package.json        # 扩展 manifest 与脚本
├── README.md           # 用户说明
└── README_DEV.md       # 开发与发布说明
```

## 脚本说明


| 命令                           | 说明                                                      |
| ---------------------------- | ------------------------------------------------------- |
| `pnpm run install:mcp`       | 安装 server 依赖并执行 `build:server`                          |
| `pnpm run build:server`      | 使用 esbuild 将 `server/index.js` 打包为 `server/dist/mcp.js` |
| `pnpm run dev:prep`          | 仅构建 MCP（等同于 `build:server`），用于本地开发前准备                   |
| `pnpm run package`           | 执行 `vsce package` 生成 `.vsix` 包                          |
| `pnpm run vscode:prepublish` | 发布前自动执行：安装依赖、构建 server（由 vsce 在 publish 时调用）            |


开发时修改 `server/` 下代码后需重新执行 `pnpm run build:server`（或 `install:mcp`）再在 Cursor 中调试扩展。

## 本地调试

1. 在 VS Code/Cursor 中打开本仓库
2. 按 `F5` 或从「运行和调试」启动「Extension Development Host」
3. 在新窗口中安装并启用本扩展，执行「Salesforce MCP: 启动服务」进行验证

## 打包与发布

### 打包为 VSIX（仅本地）

```bash
pnpm run build:server
pnpm run package
```

会在项目根目录生成 `sf-mcp-<version>.vsix`。发布前会执行 `vscode:prepublish`，因此直接 `vsce package` 也会先构建 server。

### 发布到扩展市场

1. 安装 vsce：`pnpm add -g @vscode/vsce`（或使用项目内 `pnpm exec vsce`）
2. 登录对应市场（如 `vsce login <publisher>`）
3. 执行发布：
  ```bash
   pnpm run package   # 可选：先本地打一次包确认无误
   vsce publish       # 或 pnpm exec vsce publish
  ```

发布时会自动执行 `vscode:prepublish`（安装依赖并构建 `server/dist/mcp.js`）。

## 许可证

MIT