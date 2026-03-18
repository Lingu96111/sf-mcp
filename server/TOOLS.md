# Salesforce MCP 工具清单

本文档列出 MCP 服务通过 MCP 暴露的所有工具，按模块分组。

---

## 1. 查询与 API（tools_query）

| 工具名 | 说明 | 参数 |
|--------|------|------|
| `run_soql` | 执行 SOQL 查询，返回记录列表（只读）。 | `query: str` |
| `run_sosl` | 执行 SOSL 搜索，返回匹配记录列表（只读）。 | `search: str` |
| `run_tooling_query` | 执行 Tooling API SOQL 查询（查 ApexClass、ApexTrigger、ValidationRule 等元数据，只读）。 | `query: str` |
| `rest_get` | 对 Salesforce REST API 发起任意 GET 请求（只读）。 | `path: str` |
| `get_org_limits` | 查询当前 Org 的 API 调用限额和使用量（只读）。 | 无 |
| `get_recent_api_usage` | 查询最近一段时间内的 API 使用情况（只读）。 | `hours: int = 24` |

---

## 2. 元数据与对象配置（tools_metadata）

| 工具名 | 说明 | 参数 |
|--------|------|------|
| `get_object_fields` | 查询指定对象的字段信息：API 名称、标签、类型、长度（只读）。 | `objName: str` |
| `get_record` | 按对象名和记录 Id 查询单条记录（只读）。 | `objName: str`, `recordId: str` |
| `list_objects` | 查询当前 Org 中所有可通过 SOQL 查询的对象 API 名称列表（只读）。 | 无 |
| `get_record_types` | 查询指定对象的所有 RecordType：Id、DeveloperName、Name、是否激活（只读）。 | `objName: str` |
| `describe_object` | 查询指定对象的完整 describe 信息（只读）。 | `objName: str` |
| `get_object_layout` | 查询指定对象的页面布局摘要，返回各布局包含的字段列表（只读）。 | `objName: str` |
| `get_child_relations` | 查询指定对象的所有子关系（相关列表）：子对象名、关系名、外键字段（只读）。 | `objName: str` |
| `get_picklist_values` | 查询指定对象某个 Picklist 字段的所有可选值：label、value、是否默认、是否激活（只读）。 | `objName: str`, `fieldName: str` |
| `get_validation_rules` | 查询指定对象上所有验证规则：名称、是否激活、错误条件公式、错误消息（只读）。 | `objName: str` |
| `get_compact_layouts` | 查询指定对象的紧凑布局：布局 Id、名称、字段列表（只读）。 | `objName: str` |
| `get_lightning_pages_for_object` | 查询与指定对象相关的 Lightning Record Page（只读，依赖 FlexiPage）。 | `objName: str` |
| `get_object_config_overview` | 汇总指定对象的配置概览（只读）：组合 describe、验证规则、Trigger、Flow、Workflow、紧凑布局等。 | `objName: str` |

---

## 3. Apex 与自动化（tools_apex）

| 工具名 | 说明 | 参数 |
|--------|------|------|
| `get_apex_logs` | 查询最近的 Apex 调试日志列表（只读）。默认 10 条，最多 50 条。 | `maxCount: int = 10` |
| `get_apex_log_body` | 根据日志 Id 获取 Apex 调试日志的完整内容（只读）。 | `logId: str` |
| `get_apex_source` | 查询指定 Apex 类在 Org 中的源代码和最后修改时间（只读）。 | `className: str` |
| `get_triggers_for_object` | 查询指定对象上的 Apex Trigger 列表：名称、对象、状态、事件、最后修改时间（只读）。 | `objName: str` |
| `get_flows_for_object` | 查询与指定对象相关的 Record-Triggered Flow（只读）。 | `objName: str` |
| `get_workflows_for_object` | 查询指定对象上的 Workflow Rule 列表（只读）。 | `objName: str` |
| `list_apex_classes` | 查询 ApexClass 列表（只读）。支持名称模糊匹配与条数限制。 | `nameLike: Optional[str]`, `limit: int = 100` |
| `list_apex_triggers` | 查询 ApexTrigger 列表（只读）。支持名称模糊匹配与条数限制。 | `nameLike: Optional[str]`, `limit: int = 100` |
| `get_apex_tests_for_class` | 查询可能引用指定业务类的测试类（只读，通过 Body LIKE 弱引用搜索）。 | `className: str` |

---

## 4. 用户与权限（tools_user_security）

| 工具名 | 说明 | 参数 |
|--------|------|------|
| `get_current_user_info` | 查询当前登录用户的基础信息：Id、Username、Email、Name 等（只读）。 | 无 |
| `get_org_info` | 查询当前 Org 的基础信息（只读）。 | 无 |
| `list_users` | 查询用户列表（只读）。可按是否激活过滤，限制条数（最大 200）。 | `isActive: Optional[bool]`, `limit: int = 50` |
| `get_user_detail` | 查询指定 User 的详细信息（只读）。 | `userId: str` |
| `list_profiles` | 查询当前 Org 中所有 Profile（只读）。 | 无 |
| `list_permission_sets` | 查询当前 Org 中所有 PermissionSet（只读）。 | 无 |
| `get_object_permissions_for_profile` | 查询指定 Profile 对某对象的权限：对象级 CRUD、ViewAll/ModifyAll（只读）。 | `objName: str`, `profileId: str` |
| `get_object_permissions_for_user` | 查询某用户对指定对象的权限概览（只读）。聚合 Profile 与 PermissionSet 做 OR。 | `objName: str`, `userId: str` |
| `get_field_level_security_for_profile` | 查询指定 Profile 对某字段的字段级安全：readable/editable（只读）。 | `objName: str`, `fieldName: str`, `profileId: str` |
| `get_field_level_security_for_user` | 查询某用户对指定字段的字段级安全（只读）。聚合 Profile 与 PermissionSet。 | `objName: str`, `fieldName: str`, `userId: str` |
| `get_login_history` | 查询指定用户最近的登录历史：LoginHistory，登录时间、IP、状态等（只读）。 | `userId: str`, `limit: int = 20` |
| `get_user_access_overview` | 汇总某用户对指定对象及字段的访问概览（只读）。组合用户详情、对象权限、字段级安全。 | `userId: str`, `objName: str`, `fieldNameList: Optional[List[str]]` |

---

## 统计

| 模块 | 工具数量 |
|------|----------|
| tools_query | 6 |
| tools_metadata | 12 |
| tools_apex | 9 |
| tools_user_security | 12 |
| **合计** | **39** |

以上工具均为只读，不执行任何 DML 或元数据写入。
