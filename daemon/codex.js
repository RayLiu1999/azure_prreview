import { fileURLToPath } from 'node:url'
import { capture, runJsonlProcess } from './process.js'
import { buildPrompt, READ_ONLY_TOOLS } from './prompt.js'

export async function loadCodexAzureMcp(codexPath = 'codex') {
  try {
    const { stdout } = await capture(codexPath, ['mcp', 'get', 'azure-devops', '--json'])
    const config = JSON.parse(stdout)
    if (config.enabled === false || !config.transport) throw new Error('disabled')
    return config
  } catch {
    throw new Error('無法讀取 Codex azure-devops MCP；請確認 PRREVIEW_CODEX 並執行 codex mcp get azure-devops --json 檢查設定。')
  }
}

function toml(value) {
  if (Array.isArray(value)) return `[${value.map(toml).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([k,v]) => `${JSON.stringify(k)}=${toml(v)}`).join(',')}}`
  return JSON.stringify(value)
}

export function buildCodexInvocation(prompt, mcp, options = {}) {
  if (mcp.enabled === false) throw new Error('azure-devops MCP 已停用')
  const transport = mcp.transport || mcp
  const env = { ...process.env }
  // MCP calls are read-only in this workflow.  Explicitly approve only this
  // allowlisted server so `approval_policy="never"` does not auto-cancel
  // otherwise safe read requests when Codex runs without a TTY.
  const server = {
    enabled: true,
    required: true,
    enabled_tools: [...READ_ONLY_TOOLS],
    default_tools_approval_mode: 'approve',
  }
  if (transport.type === 'stdio' || transport.command) {
    if (typeof transport.command !== 'string' || !transport.command) throw new Error('azure-devops MCP 缺少 command')
    server.command = transport.command
    server.args = transport.args || []
    if (transport.cwd) server.cwd = transport.cwd
    const literals = transport.env || {}
    for (const [key, value] of Object.entries(literals)) {
      if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error('MCP env 格式無效')
      env[key] = value
    }
    server.env_vars = [...new Set([...(transport.env_vars || []), ...Object.keys(literals)])]
  } else if (transport.type === 'streamable_http' && transport.url) {
    const url = new URL(transport.url)
    if (url.username || url.password || url.search || url.hash) throw new Error('MCP URL 不可內嵌憑證；請使用環境變數認證')
    server.url = transport.url
    if (transport.bearer_token_env_var) server.bearer_token_env_var = transport.bearer_token_env_var
    server.env_http_headers = { ...(transport.env_http_headers || {}) }
    Object.entries(transport.http_headers || {}).forEach(([header, value], i) => {
      const key = `PRREVIEW_MCP_HEADER_${i}`
      env[key] = value
      server.env_http_headers[header] = key
    })
  } else throw new Error('不支援的 azure-devops MCP transport')
  for (const key of ['startup_timeout_sec', 'tool_timeout_sec']) {
    if (Number.isFinite(mcp[key])) server[key] = mcp[key]
  }
  const args = ['exec', '--json', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check',
    '--ignore-user-config', '--ignore-rules', '-c', `mcp_servers=${toml({ 'azure-devops': server })}`,
    '-c', 'approval_policy="never"', '-c', 'features.shell_tool=false',
    '-c', 'features.multi_agent=false', '-c', 'web_search="disabled"',
    '--output-schema', fileURLToPath(new URL('./prompts/findings.schema.json', import.meta.url))]
  if (options.model) args.push('--model', options.model)
  args.push('--', prompt)
  return { args, env }
}

export function parseCodexStreamEvent(line) {
  let event
  if (typeof line !== 'string' || !line.trim()) return null
  try { event = JSON.parse(line) } catch { return null }
  if (!event || typeof event !== 'object') return null
  const type = String(event.type || '').toLowerCase()
  if (type === 'turn.failed' || type === 'error' || type.endsWith('.failed')) {
    const message = event.error?.message || event.message || (typeof event.error === 'string' ? event.error : '') || 'Codex 審核失敗'
    return { kind: 'result', text: String(message), isError: true }
  }
  if (type === 'turn.completed' && typeof event.last_agent_message === 'string') {
    return { kind: 'result', text: event.last_agent_message, isError: false }
  }
  const item = event.item
  if (!item || !['item.started', 'item.updated', 'item.completed'].includes(type)) return null
  const itemType = String(item.type || '').toLowerCase()
  if (itemType === 'mcp_tool_call' || itemType === 'mcpcall' || itemType === 'mcp_call') {
    const declaredServer = item.server || item.server_name || item.namespace || ''
    const rawTool = String(item.tool || item.tool_name || item.name || '')
    const prefix = rawTool.match(/^mcp__([^_]+)__([^/]+)$/i)
    const slash = rawTool.match(/^([^/]+)\/([^/]+)$/)
    const server = declaredServer || prefix?.[1] || slash?.[1]
    const tool = prefix?.[2] || slash?.[2] || rawTool.replace(/^azure-devops__/, '')
    if (String(server).toLowerCase() !== 'azure-devops' || !READ_ONLY_TOOLS.includes(tool)) {
      return { kind: 'violation', message: 'Codex 呼叫了非唯讀白名單 MCP 工具，已停止審核。' }
    }
    let input = item.arguments || item.input || {}
    if (typeof input === 'string') {
      try { input = JSON.parse(input) } catch { input = {} }
    }
    const detail = ['path', 'file_path', 'searchText', 'query'].map(k => input[k]).find(v => typeof v === 'string') || ''
    return { kind: 'tool', tool, detail }
  }
  if (itemType === 'file_change' || itemType === 'apply_patch_tool_call' || itemType === 'apply_patch') {
    return { kind: 'violation', message: 'Codex 啟動了已停用的檔案或命令工具，已停止審核。' }
  }
  if (itemType === 'command_execution' || itemType === 'shell_command') {
    const command = item.command || item.cmd || ''
    return { kind: 'tool', tool: 'command_execution', detail: Array.isArray(command) ? command.join(' ') : String(command || '') }
  }
  if ((itemType === 'agent_message' || itemType === 'message') && type === 'item.completed') {
    const text = typeof item.text === 'string' ? item.text
      : typeof item.content === 'string' ? item.content
      : Array.isArray(item.content) ? item.content.map(part => part?.text || part?.content || '').join('') : ''
    if (!text) return null
    return { kind: 'result', text, isError: false }
  }
  return null
}

export function runCodexReview(pr, options = {}) {
  const executable = options.codexPath || process.env.PRREVIEW_CODEX || 'codex'
  return runJsonlProcess('codex', async () => ({
    executable,
    ...buildCodexInvocation(await buildPrompt(pr), await loadCodexAzureMcp(executable), options),
  }), parseCodexStreamEvent, options)
}
