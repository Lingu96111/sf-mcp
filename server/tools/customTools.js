// 用户自定义工具：从工作区 .salesforce-mcp/custom-tools.json 加载配置并动态注册 MCP 工具
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  sfQueryAll,
  sfToolingQuery,
  sfRestGet,
  sfRestRequest,
  escapeSoqlLiteral
} from "../core/connection.js";
import { textContent } from "../core/utils.js";

const LOG_TAG = "[CustomTool]";
const CONFIG_DIR = ".salesforce-mcp";
const CONFIG_FILE = "custom-tools.json";
const MAX_RESULT_RECORDS = 200;
const VALID_TYPES = ["soql", "tooling_query", "rest"];
const VALID_PARAM_TYPES = ["string", "number", "boolean"];
const VALID_HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const NAME_PREFIX_RE = /^(custom_|user_)/;
const NAME_PATTERN_RE = /^[a-z][a-z0-9_]*$/;

// 从 当前工作区逐级向上查找 .salesforce-mcp/custom-tools.json
function findConfigFile() {
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, CONFIG_DIR, CONFIG_FILE);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// 移除 JSONC 中的行注释（//）和块注释（/* */），以及尾随逗号
function stripJsonc(raw) {
  let result = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  result = result.replace(/\/\/.*$/gm, "");
  result = result.replace(/,\s*([}\]])/g, "$1");
  return result;
}

// 根据参数定义构建 zod schema 对象
function buildZodSchema(paramDefList) {
  const shape = {};
  for (const p of paramDefList) {
    let field;
    if (p.type === "number") {
      field = z.number();
    } else if (p.type === "boolean") {
      field = z.boolean();
    } else {
      field = z.string();
    }
    if (p.description) field = field.describe(p.description);
    if (!p.required) {
      field = field.optional();
      if (p.default !== undefined) field = field.default(p.default);
    }
    shape[p.name] = field;
  }
  return shape;
}

// 替换模板中的 {{param}} 占位符，字符串类型参数经过 SOQL 转义
function renderTemplate(tpl, args, paramDefList, toolType) {
  const paramTypeMap = {};
  for (const p of paramDefList) paramTypeMap[p.name] = p;
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    let val = args[key];
    const def = paramTypeMap[key];
    if (val === undefined || val === null) {
      val = def?.default !== undefined ? def.default : "";
    }
    if (def?.type === "string" && toolType !== "rest") {
      return escapeSoqlLiteral(String(val));
    }
    return String(val);
  });
}

// 校验单条工具配置，返回错误消息或 null
function validateToolDef(def, idx) {
  if (!def || typeof def !== "object") {
    return `索引 ${idx}: 不是有效的对象`;
  }
  if (!def.name || typeof def.name !== "string") {
    return `索引 ${idx}: 缺少 name 字段`;
  }
  if (!NAME_PATTERN_RE.test(def.name)) {
    return `工具 '${def.name}': name 只允许小写字母、数字和下划线，且必须以字母开头`;
  }
  if (!def.description || typeof def.description !== "string") {
    return `工具 '${def.name}': 缺少 description`;
  }
  if (!VALID_TYPES.includes(def.type)) {
    return `工具 '${def.name}': type 必须是 ${VALID_TYPES.join("/")} 之一，当前为 '${def.type}'`;
  }
  if (!def.template || typeof def.template !== "string") {
    return `工具 '${def.name}': 缺少 template`;
  }
  if (def.type === "rest" && def.method) {
    if (!VALID_HTTP_METHODS.includes(String(def.method).toUpperCase())) {
      return `工具 '${def.name}': method 必须是 ${VALID_HTTP_METHODS.join("/")} 之一`;
    }
  }
  if (def.parameters && !Array.isArray(def.parameters)) {
    return `工具 '${def.name}': parameters 必须是数组`;
  }
  const declaredNames = new Set();
  for (const p of def.parameters || []) {
    if (!p.name) return `工具 '${def.name}': 参数缺少 name`;
    if (p.type && !VALID_PARAM_TYPES.includes(p.type)) {
      return `工具 '${def.name}': 参数 '${p.name}' 的 type 必须是 ${VALID_PARAM_TYPES.join("/")}`;
    }
    declaredNames.add(p.name);
  }
  const placeholders = [...def.template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
  const bodyPlaceholders = def.body
    ? [...def.body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])
    : [];
  for (const ph of [...placeholders, ...bodyPlaceholders]) {
    if (!declaredNames.has(ph)) {
      return `工具 '${def.name}': 模板占位符 '{{${ph}}}' 未在 parameters 中声明`;
    }
  }
  return null;
}

// 截断过多记录，防止上下文溢出
function truncateResult(records) {
  if (!Array.isArray(records)) return records;
  if (records.length <= MAX_RESULT_RECORDS) return records;
  const truncated = records.slice(0, MAX_RESULT_RECORDS);
  truncated.push({
    _truncated: true,
    _message: `结果过长已截断（共 ${records.length} 条，仅返回前 ${MAX_RESULT_RECORDS} 条）。请在配置的 template 中添加 LIMIT 参数。`
  });
  return truncated;
}

// 执行自定义工具
async function executeTool(def, args) {
  const paramDefList = def.parameters || [];
  const renderedTpl = renderTemplate(def.template, args, paramDefList, def.type);

  if (def.type === "soql") {
    console.error(`${LOG_TAG} ${def.name} SOQL: ${renderedTpl}`);
    const result = await sfQueryAll(renderedTpl);
    const records = truncateResult(result.records || []);
    return textContent(records);
  }

  if (def.type === "tooling_query") {
    console.error(`${LOG_TAG} ${def.name} Tooling: ${renderedTpl}`);
    const result = await sfToolingQuery(renderedTpl);
    const records = truncateResult(result.records || []);
    return textContent(records);
  }

  if (def.type === "rest") {
    const method = (def.method || "GET").toUpperCase();
    let body = null;
    if (def.body) {
      const renderedBody = renderTemplate(def.body, args, paramDefList, def.type);
      body = renderedBody;
    }
    console.error(`${LOG_TAG} ${def.name} REST ${method} ${renderedTpl}${body ? ` body=${body}` : ""}`);
    if (method === "GET") {
      const data = await sfRestGet(renderedTpl);
      return textContent(data);
    }
    const data = await sfRestRequest(renderedTpl, method, body);
    return textContent(data);
  }

  return textContent({ error: `未知的工具类型: ${def.type}` });
}

export function registerToolsCustom(mcpServer) {
  const configPath = findConfigFile();
  if (!configPath) {
    console.error(`${LOG_TAG} 未找到 ${CONFIG_DIR}/${CONFIG_FILE}，跳过自定义工具加载。`);
    return;
  }

  let rawContent;
  try {
    rawContent = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    console.error(`${LOG_TAG} 读取配置文件失败 (${configPath}): ${err.message}`);
    return;
  }

  let toolDefList;
  try {
    const cleaned = stripJsonc(rawContent);
    toolDefList = JSON.parse(cleaned);
  } catch (err) {
    console.error(`${LOG_TAG} JSON 解析失败 (${configPath}): ${err.message}`);
    return;
  }

  if (!Array.isArray(toolDefList)) {
    console.error(`${LOG_TAG} 配置文件根元素必须是数组 (${configPath})`);
    return;
  }

  console.error(`${LOG_TAG} 从 ${configPath} 加载到 ${toolDefList.length} 条自定义工具配置`);
  let registered = 0;

  for (let i = 0; i < toolDefList.length; i++) {
    const def = toolDefList[i];
    try {
      const errMsg = validateToolDef(def, i);
      if (errMsg) {
        console.error(`${LOG_TAG} 跳过工具: ${errMsg}`);
        continue;
      }

      const zodShape = buildZodSchema(def.parameters || []);

      mcpServer.tool(
        def.name,
        def.description,
        zodShape,
        async (args) => {
          try {
            return await executeTool(def, args);
          } catch (execErr) {
            console.error(`${LOG_TAG} 执行 '${def.name}' 失败: ${execErr.message}`);
            return textContent({ error: `工具 '${def.name}' 执行失败: ${execErr.message}` });
          }
        }
      );
      registered++;
      console.error(`${LOG_TAG} 已注册: ${def.name} (${def.type})`);
    } catch (regErr) {
      console.error(`${LOG_TAG} 注册工具 '${def.name || `索引${i}`}' 时异常: ${regErr.message}`);
    }
  }

  console.error(`${LOG_TAG} 自定义工具注册完成，成功 ${registered}/${toolDefList.length} 个`);
}
