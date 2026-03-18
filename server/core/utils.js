// MCP 工具层公共方法

// 将任意值转为 MCP 文本响应格式 { content: [{ type, text }] }
export function textContent(obj) {
  return {
    content: [{ type: "text", text: JSON.stringify(obj, null, 2) }]
  };
}
