# SF MCP — 让 AI 直接操作你的 Salesforce Org

> 安装即用，无需写代码。让 Cursor AI 帮你查数据、看日志、读取元数据，甚至修改 Org 记录。

---

## 这是什么？

**MCP-Salesforce** 是一个 Cursor 插件，安装后 AI 助手可以直接：

- 查询 Salesforce 数据（SOQL/SOSL）
- 查看 Apex 代码、日志、Trigger、Flow
- 读取字段信息、对象配置、验证规则
- 查询权限、Profile、用户信息
- 执行你自定义的查询/修改操作（默认工具只支持查询操作）

---

## 第一步：安装插件

### 方式一：扩展市场（推荐）

1. 在 Cursor 中按 `Ctrl+Shift+X`（Mac：`Cmd+Shift+X`）打开扩展视图
2. 搜索 **SF MCP** 或 **Salesforce MCP**
3. 点击安装

### 方式二：手动安装 VSIX

1. 从 [Releases 页面](https://github.com/lingu96111/sf-mcp/releases) 下载 `.vsix` 文件
2. 在扩展视图右上角点击「…」→「从 VSIX 安装…」，选择刚下载的文件

---

## 第二步：连接你的 Salesforce Org

插件支持两种连接方式，选一种即可。

### 方式 A：Salesforce CLI（推荐，最简单）

**前提**：你已经安装了 [Salesforce CLI](https://developer.salesforce.com/tools/sfcli) 并且登录过 Org。

1. 确认你已连接 Org（在终端运行 `sf org display` 能看到 Org 信息即可）
2. 打开你的 Salesforce 项目文件夹，插件会自动读取 `.sf/config.json` 中的目标 Org
3. **无需任何额外配置**，直接进入第三步

> 如果你有多个 Org，可以在插件设置中填写 `salesforceMcp.sfOrgAlias`（Org 别名）来指定使用哪一个。

### 方式 B：Access Token（不使用 CLI 时）

如果你没有安装 Salesforce CLI，可以用 Access Token 直接连接：

1. 按 `Ctrl+Shift+X` 打开扩展视图 → 找到 MCP-Salesforce → 点击齿轮图标 → 「扩展设置」
2. 填写以下两项：


| 设置项                           | 填写什么                                          |
| ----------------------------- | --------------------------------------------- |
| `salesforceMcp.sfAuthMode`    | 改为 `token`                                    |
| `salesforceMcp.sfInstanceUrl` | 你的 Org URL，例如 `https://xxx.my.salesforce.com` |
| `salesforceMcp.sfAccessToken` | 你的 Access Token（从 Salesforce Setup 中获取）       |


---

## 第三步：启动 MCP 服务

1. 按 `Ctrl+Shift+P`（Mac：`Cmd+Shift+P`）打开命令面板
2. 输入并执行：**Salesforce MCP: 启动服务**
3. 看到状态栏右下角出现 `✔ SFMCP 就绪` 即表示成功

---

## 第四步：在 Cursor 中启用

1. 按 `Ctrl+Shift+J`（Mac：`Cmd+Shift+J`）打开 Cursor 设置
2. 进入 **Tools & MCP** 标签页
3. 找到 **salesforce-mcp**，点击启用（开关打开）

---

## 现在可以做什么？

打开 Cursor AI 对话框，直接用自然语言提问，例如：

```
帮我查询最近 10 条 Apex 日志
```

```
列出 Account 对象所有的字段名和类型
```

```
找出 OrderTrigger 的源代码
```

```
查询 UserA@xxx.com 拥有哪些权限集
```

AI 会自动选择合适的工具并返回结果，你不需要手动输入任何 SOQL 或 API。

---

## 自定义工具

如果内置工具不够用，你可以**不写代码，只写配置文件**来添加自己的工具。

### 怎么做？

在你的 **Salesforce 项目根目录**新建一个文件：

```
.salesforce-mcp/custom-tools.json
```

然后写入你想要的工具，格式如下：

```jsonc
[
  {
    // 查询工具示例：按行业查 Account
    "name": "custom_accounts_by_industry",
    "description": "按行业查询 Account 列表",
    "type": "soql",
    "template": "SELECT Id, Name FROM Account WHERE Industry = '{{industry}}' LIMIT {{limit}}",
    "parameters": [
      { "name": "industry", "type": "string", "required": true, "description": "行业名称，例如 Technology" },
      { "name": "limit", "type": "number", "required": false, "default": 50 }
    ]
  },
  {
    // 修改工具示例：更新 Account 的名称
    "name": "custom_update_account_name",
    "description": "根据 Id 修改 Account 的 Name",
    "type": "rest",
    "method": "PATCH",
    "template": "/sobjects/Account/{{recordId}}",
    "body": "{\"Name\": \"{{name}}\"}",
    "parameters": [
      { "name": "recordId", "type": "string", "required": true, "description": "Account 记录 Id" },
      { "name": "name", "type": "string", "required": true, "description": "新的名称" }
    ]
  }
]
```

保存后，**重新执行「Salesforce MCP: 启动服务」**，AI 就能调用你定义的工具了。

### 工具类型说明


| type            | 用途                                                     |
| --------------- | ------------------------------------------------------ |
| `soql`          | 执行 SOQL 查询（只读）                                         |
| `tooling_query` | 查询 Apex 类、Trigger 等元数据（只读）                             |
| `rest`          | 调用 REST API，`method` 可设为 `GET/POST/PATCH/DELETE`（可读可写） |


### 占位符规则

模板中用 `{{参数名}}` 表示占位符，参数名必须在 `parameters` 数组中声明。

### 更多示例

参考插件内的示例文件 `.salesforce-mcp/custom-tools.json.example`，里面包含 4 种典型用法（SOQL 查询、Tooling 查询、REST GET、REST POST）。

---

## 常见问题

**Q：状态栏显示「SFMCP 未配置」怎么办？**

A：检查你的 Salesforce 项目文件夹是否已通过 CLI 连接了 Org（运行 `sf org display`），或者在插件设置中手动填写 Org 别名。

**Q：AI 说找不到工具，怎么办？**

A：确认已在 Cursor「Tools & MCP」里开启了 **salesforce-mcp**，并且重新执行过「Salesforce MCP: 启动服务」。

**Q：自定义工具改完后没有生效？**

A：自定义工具在服务启动时加载，改完 `custom-tools.json` 后需要重新执行「Salesforce MCP: 启动服务」。

**Q：查询结果只返回了 200 条？**

A：超过 200 条时系统会自动截断，防止 AI 上下文溢出。建议在 SOQL 模板中加 `LIMIT` 参数控制返回数量。

---

## 系统要求

- Cursor 或 VS Code 1.85.0 及以上
- Node.js 18 及以上
- CLI 模式需安装 [Salesforce CLI](https://developer.salesforce.com/tools/sfcli) 并登录

---

## 许可证

MIT — 免费使用，欢迎贡献。

[GitHub 仓库](https://github.com/lingu96111/sf-mcp) · [开发者文档](README_DEV.md)