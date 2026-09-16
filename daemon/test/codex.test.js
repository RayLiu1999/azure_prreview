import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCodexInvocation, parseCodexStreamEvent } from '../codex.js'

const schema = 'C:/prreview/daemon/prompts/findings.schema.json'
const mcp = {
  enabled: true,
  transport: {
    type: 'stdio',
    command: 'node',
    args: ['C:/mcp/azure-devops.mjs'],
    cwd: 'C:/mcp',
    env: { PERSONAL_ACCESS_TOKEN: 'super-secret', NODE_OPTIONS: '--use-system-ca' },
    env_vars: ['EXTRA_SETTING'],
  },
  startup_timeout_sec: 15,
  tool_timeout_sec: 60,
}

test('空行、壞 JSON 與未知事件回傳 null', () => {
  assert.equal(parseCodexStreamEvent(''), null)
  assert.equal(parseCodexStreamEvent('not json'), null)
  assert.equal(parseCodexStreamEvent(JSON.stringify({ type: 'thread.started' })), null)
})

test('MCP tool call 轉成共同工具事件', () => {
  const line = JSON.stringify({ type: 'item.started', item: {
    type: 'mcp_tool_call', server: 'azure-devops', tool: 'repo_file', arguments: { path: 'src/a.cs' },
  } })
  assert.deepEqual(parseCodexStreamEvent(line), { kind: 'tool', tool: 'repo_file', detail: 'src/a.cs' })
})

test('支援 Codex 帶前綴的工具名稱與 agent message', () => {
  assert.equal(parseCodexStreamEvent(JSON.stringify({ type: 'item.completed', item: {
    type: 'mcp_tool_call', server: 'azure-devops', tool: 'mcp__azure-devops__repo_pull_request', arguments: '{}',
  } })).tool, 'repo_pull_request')
  assert.deepEqual(parseCodexStreamEvent(JSON.stringify({ type: 'item.completed', item: {
    type: 'agent_message', content: [{ type: 'text', text: '{"findings":[]}' }],
  } })), { kind: 'result', text: '{"findings":[]}', isError: false })
})

test('turn.failed 與 error 轉成錯誤結果', () => {
  assert.equal(parseCodexStreamEvent(JSON.stringify({ type: 'turn.failed', error: { message: 'failed' } })).isError, true)
  assert.equal(parseCodexStreamEvent(JSON.stringify({ type: 'error', message: 'bad' })).text, 'bad')
})

test('turn.completed 可作為最終訊息 fallback', () => {
  assert.deepEqual(parseCodexStreamEvent(JSON.stringify({
    type: 'turn.completed',
    last_agent_message: '{"summary":"ok","findings":[]}',
  })), {
    kind: 'result',
    text: '{"summary":"ok","findings":[]}',
    isError: false,
  })
})

test('非白名單 MCP 與 file change 轉成 violation', () => {
  assert.equal(parseCodexStreamEvent(JSON.stringify({ type: 'item.started', item: {
    type: 'mcp_tool_call', server: 'other', tool: 'repo_file', arguments: {},
  } })).kind, 'violation')
  assert.equal(parseCodexStreamEvent(JSON.stringify({ type: 'item.completed', item: {
    type: 'file_change', path: 'a.txt',
  } })).kind, 'violation')
})

test('command execution 僅回報進度，read-only sandbox 負責限制寫入', () => {
  assert.deepEqual(parseCodexStreamEvent(JSON.stringify({ type: 'item.started', item: {
    type: 'command_execution', command: 'git diff --stat',
  } })), { kind: 'tool', tool: 'command_execution', detail: 'git diff --stat' })
})

test('invocation 必含隔離與 schema 參數，且 secret 不進 argv', () => {
  const { args, env } = buildCodexInvocation('review prompt', mcp, { model: 'gpt-5.3-codex' })
  for (const flag of ['exec', '--json', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '--output-schema']) {
    assert.ok(args.includes(flag), flag)
  }
  assert.equal(args[args.indexOf('--output-schema') + 1].endsWith('findings.schema.json'), true)
  assert.ok(args.includes('--model'))
  assert.ok(args.includes('--'))
  assert.equal(args.some(arg => arg.includes('super-secret')), false)
  assert.equal(env.PERSONAL_ACCESS_TOKEN, 'super-secret')
  const configArg = args[args.indexOf('-c') + 1]
  assert.match(configArg, /azure-devops/)
  assert.match(configArg, /enabled_tools/)
  assert.match(configArg, /env_vars/)
  assert.doesNotMatch(configArg, /super-secret/)
  assert.match(configArg, /required/)
  assert.match(configArg, /default_tools_approval_mode.*approve/)
})

test('未設定 MCP 時不會產生 invocation', () => {
  assert.throws(() => buildCodexInvocation('prompt', { enabled: true, transport: {} }), /transport/)
  assert.throws(() => buildCodexInvocation('prompt', { enabled: false, transport: mcp.transport }), /停用/)
})

test('HTTP MCP URL 不接受 query 或 fragment 內嵌憑證', () => {
  const base = { enabled: true, transport: { type: 'streamable_http', url: 'https://mcp.example.test/server' } }
  assert.doesNotThrow(() => buildCodexInvocation('prompt', base))
  assert.throws(() => buildCodexInvocation('prompt', { ...base, transport: { ...base.transport, url: `${base.transport.url}?token=secret` } }), /URL/)
  assert.throws(() => buildCodexInvocation('prompt', { ...base, transport: { ...base.transport, url: `${base.transport.url}#token=secret` } }), /URL/)
})
