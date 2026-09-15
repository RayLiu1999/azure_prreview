const MCP_PREFIX = /^mcp__[a-z0-9-]+__/i

function toolDetail(input) {
  if (!input || typeof input !== 'object') return ''
  for (const key of ['path', 'file_path', 'query', 'pattern']) {
    if (typeof input[key] === 'string') return input[key]
  }
  return ''
}

export function parseStreamEvent(line) {
  if (typeof line !== 'string' || !line.trim()) return null

  let event
  try {
    event = JSON.parse(line)
  } catch {
    return null
  }
  if (!event || typeof event !== 'object') return null

  if (event.type === 'result') {
    if (typeof event.result !== 'string') return null
    return { kind: 'result', text: event.result, isError: event.is_error === true }
  }

  if (event.type === 'assistant') {
    const content = event.message?.content
    if (!Array.isArray(content)) return null

    for (const block of content) {
      if (block?.type === 'tool_use' && typeof block.name === 'string') {
        return {
          kind: 'tool',
          tool: block.name.replace(MCP_PREFIX, ''),
          detail: toolDetail(block.input),
        }
      }
    }
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        return { kind: 'text', text: block.text }
      }
    }
    return null
  }

  return null
}
