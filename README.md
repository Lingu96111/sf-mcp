<h1 style="text-align: center">Salesforce MCP</h1>

<p align="center">
  <img src="https://img.shields.io/badge/Salesforce-MCP-00A1E0?style=flat&logo=Salesforce" alt="Salesforce MCP" />
  <img src="https://img.shields.io/badge/Cursor-MCPTools-9D34DA?style=flat&logo=Cursor" alt="Cursor MCP Tools" />
</p>
<p align="center">
  <img src="https://img.shields.io/github/actions/workflow/status/Lingu96111/sf-mcp/release.yml?label=BUILD&style=flat&color=2ECC71" alt="Build Status" />
  <img src="https://img.shields.io/github/v/release/Lingu96111/sf-mcp?label=RELEASE&style=flat&color=1F4690" alt="Release Version" />
  <a href="https://github.com/Lingu96111/sf-mcp"><img src="https://img.shields.io/badge/Github-repo-333333?style=flat&logo=Github" alt="GitHub Repository" /></a>
  <img src="https://img.shields.io/badge/LICENSE-MIT-F39C12?style=flat" alt="License MIT" />
</p>

## 一、简介

SF MCP（Salesforce MCP）是一款为 Cursor 编辑器打造的扩展插件，核心目标是让 AI 能够直接操作 Salesforce Org，无需开发者编写代码即可借助 Cursor AI 完成 Salesforce 相关的数据查询、元数据读取、日志查看等操作，大幅降低 Salesforce 日常运维与开发的操作成本。

## 二、适用场景

适合 Salesforce 开发者、管理员日常工作：使用 AI 快速查询数据/元数据、排查 Apex 日志、核对权限配置等，无需手动登录 Salesforce 后台或编写 CLI 命令，通过自然语言与AI交互即可完成操作，提升工作效率。

## 三、可以让 AI 帮你做哪些事？

扩展内置的能力**以只读为主**（查询数据与配置，不会在后台悄悄改 Org 里的数据或元数据）。若你自行添加了自定义配置里的接口，才可能包含写入类操作——使用前请自行确认权限与风险。

常见用途包括：

- **数据与搜索**：按条件查记录、做搜索
- **对象与页面**：字段列表、布局、选项值、验证规则、子对象关系、配置总览等
- **开发与排障**：Apex 调试日志、类与 Trigger 源码、与对象相关的 Flow / Workflow 等
- **Flow**：按名称查找、看版本、对比差异、解析结构（适合排查流程问题）
- **用户与权限**：用户、Profile、权限集、对象/字段权限、登录历史等

想逐项核对具体能做什么，可打开 **[在线工具说明](https://github.com/lingu96111/sf-mcp/blob/main/server/TOOLS.md)**（列表略长，适合需要对照说明时使用）。

## 四、使用步骤

### 1. 安装扩展

**从扩展市场（推荐）**
在 Cursor 中按 `Ctrl+Shift+X`（Mac：`Cmd+Shift+X`），搜索 **Salesforce MCP**，安装 **Salesforce MCP for Cursor**。

**离线安装**
到 [Releases](https://github.com/lingu96111/sf-mcp/releases) 或者 下载 `.vsix`，在扩展视图右上角「⋯」里选择 **从 VSIX 安装**。

### 2. 连上你的 Salesforce

推荐先用 **Salesforce 官方 CLI** 登录 Org；没有 CLI 时也可以用访问令牌连接（见下文）。

**方式 A：已安装 Salesforce CLI（推荐）**

(1). 若尚未安装，请先安装[Salesforce CLI](https://developer.salesforce.com/tools/sfcli) 并登录 Org
(2). 在终端执行 **`sf org display`**，能正常显示当前 Org 即可
(3). 用 Cursor**打开你的 Salesforce 项目文件夹**（里面有`.sf` 配置的那种），扩展会自动使用其中的默认 Org
(4). 若本机有多个 Org，可在扩展设置里填写 **`salesforceMcp.sfOrgAlias`**，指定Org本地别名

**方式 B：不用 CLI，用访问令牌**

(1). 打开扩展设置（扩展旁齿轮 → **扩展设置**）
(2). 按下表填写（名称在设置里可搜索到）：


| 设置项                        | 怎么填                                            |
| ------------------------------- | --------------------------------------------------- |
| `salesforceMcp.sfAuthMode`    | 填`token`                                         |
| `salesforceMcp.sfInstanceUrl` | 你的登录地址，例如`https://xxx.my.salesforce.com` |
| `salesforceMcp.sfAccessToken` | 在 Salesforce**设置** 里取得的访问令牌            |

### 3. 启动连接服务

按 `Ctrl+Shift+P`（Mac：`Cmd+Shift+P`），运行 **`Salesforce MCP: 启动服务`**。
状态栏出现 **`✔ SFMCP 就绪`** 即表示已连好。

### 4. 在 Cursor 里打开开关

按 `Ctrl+Shift+J`（Mac：`Cmd+Shift+J`）打开 Cursor 设置 → **Tools & MCP** → 找到 **salesforce-mcp**，打开开关。

## 五、可以怎么问？

装好后直接自然语言提问AI即可，例如：

```text
列出 Account 上所有字段名称和类型，标出哪些是必填。
```

```text
拉最近 10 条 Apex 调试日志，看有没有报错，并总结原因。
```

```text
OrderTrigger 里 before update 做了哪些事？用要点说明。
```

```text
查一下 user@example.com 用的 Profile 和权限集有哪些。
```

## 六、进阶：自定义「常用能力」（可选）

适合 **想给团队固定几条查询或接口、又不想改扩展本身** 的场景。在 **Salesforce 项目根目录** 新建：

```text
.salesforce-mcp/custom-tools.json
```

下面是一个只读查询的示例片段：

```jsonc
[
  {
    "name": "custom_accounts_by_industry",
    "description": "按行业查询客户列表",
    "type": "soql",
    "template": "SELECT Id, Name FROM Account WHERE Industry = '{{industry}}' LIMIT {{limit}}",
    "parameters": [
      { "name": "industry", "type": "string", "required": true, "description": "行业，例如 Technology" },
      { "name": "limit", "type": "number", "required": false, "default": 50 }
    ]
  }
]
```


| 类型            | 含义                                                                     |
| ----------------- | -------------------------------------------------------------------------- |
| `soql`          | 只读数据查询                                                             |
| `tooling_query` | 只读元数据类查询                                                         |
| `rest`          | 调用 REST 接口（可按配置使用 GET/POST 等，**可能包含写入**，请谨慎配置） |

保存后执行一次 **`Salesforce MCP: 启动服务`** 才会生效。更多写法可参考 [GitHub 仓库](https://github.com/Lingu96111/sf-mcp/blob/main/.salesforce-mcp/custom-tools.json.example) 里的 `.salesforce-mcp/custom-tools.json.example`。

## 七、常见问题

**Q: 状态栏一直显示未配置**
确认已在该项目目录用 CLI 登录过（`sf org display` 正常），或在设置里填对了 **`salesforceMcp.sfOrgAlias`**。

**Q: AI 说连不上或没有相关能力**
确认 **Tools & MCP** 里已打开 **salesforce-mcp**，并已执行过 **Salesforce MCP: 启动服务**。

**Q: 改了自定义配置没反应**
需要重新执行 **Salesforce MCP: 启动服务** 才会重新加载。

**一次查出来只有很少几条、好像不全**
为避免对话过长，结果数量可能被限制（例如大约 200 条）。请让 AI 加筛选条件或分页思路（如按日期、Id 范围缩小范围）。

## 八、运行环境说明

- 使用 **Cursor** 编辑器
- 建议安装 **Node.js 22 及以上**
- 若用 CLI 方式连接，需安装 [Salesforce CLI](https://developer.salesforce.com/tools/sfcli) 并完成登录

## 九、反馈与许可

- 版本更新：[GitHub Releases](https://github.com/Lingu96111/sf-mcp/releases)
- 问题反馈：[Github Issues](https://github.com/lingu96111/sf-mcp/issues)
- 许可：[MIT](https://github.com/Lingu96111/sf-mcp?tab=MIT-1-ov-file)
