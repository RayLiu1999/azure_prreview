import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runReview, checkClaudeAvailable } from '../runner.js'

const pr = { org: 'a', project: 'b', repo: 'c', prId: 1 }
const missing = 'prreview-claude-does-not-exist'
const configDirectory = await mkdtemp(join(tmpdir(), 'prreview-claude-runner-test-'))
const configPath = join(configDirectory, 'claude.json')
await writeFile(configPath, JSON.stringify({ mcpServers: { 'azure-devops': { type: 'stdio', command: 'node', args: ['-e', 'process.exit(0)'] } } }))
after(() => rm(configDirectory, { recursive: true, force: true }))

test('不存在的 CLI 回報錯誤並正常結束串流', async () => {
  const events = []
  for await (const event of runReview(pr, { claudePath: missing, claudeMcpConfig: configPath }).events) events.push(event)
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'error')
  assert.match(events[0].message, /找不到 claude 執行檔/)
  assert.equal(await checkClaudeAvailable(missing), false)
})

test('讀取串流前取消不啟動 CLI', async () => {
  const review = runReview(pr, { claudePath: missing, claudeMcpConfig: configPath })
  review.cancel()
  const events = []
  for await (const event of review.events) events.push(event)
  assert.deepEqual(events, [{ kind: 'error', message: '已取消' }])
})
