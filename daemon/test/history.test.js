import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHistoryStore, historyRecordFromJob } from '../history.js'

const PR = { org: 'contoso', project: 'Payments', repo: 'api', prId: 42 }

const directory = await mkdtemp(join(tmpdir(), 'prreview-history-test-'))
const filePath = join(directory, 'history.json')
after(() => rm(directory, { recursive: true, force: true }))

function record(overrides = {}) {
  return {
    id: overrides.id || `job-${Math.random()}`,
    pr: overrides.pr || PR,
    agent: overrides.agent || 'claude',
    status: overrides.status || 'completed',
    startedAt: '2026-09-16T00:00:00.000Z',
    completedAt: overrides.completedAt || '2026-09-16T00:01:00.000Z',
    verdict: overrides.verdict || 'pass',
    summary: overrides.summary || '沒有問題',
    findings: overrides.findings || [],
    raw: overrides.raw || '',
    error: overrides.error || '',
  }
}

test('歷史依 PR 身分篩選，並保留 Agent 與結論', async () => {
  const store = await createHistoryStore({ filePath, maxRecords: 10 })
  await store.record(record({ id: 'one', agent: 'claude' }))
  await store.record(record({ id: 'two', agent: 'codex', verdict: 'needs_changes' }))
  await store.record(record({ id: 'other-pr', pr: { ...PR, prId: 43 } }))

  const items = await store.list(PR)
  assert.deepEqual(items.map(item => item.id), ['two', 'one'])
  assert.equal(items[0].agent, 'codex')
  assert.equal(items[0].verdict, 'needs_changes')
  assert.deepEqual(await store.list({ ...PR, prId: 999 }), [])
})

test('歷史可以寫入檔案並在重新建立 store 後讀取', async () => {
  const store = await createHistoryStore({ filePath, maxRecords: 10 })
  await store.record(record({ id: 'persisted', summary: '保留' }))
  await store.flush()
  const content = JSON.parse(await readFile(filePath, 'utf8'))
  assert.equal(content[0].id, 'persisted')

  const reloaded = await createHistoryStore({ filePath, maxRecords: 10 })
  assert.equal((await reloaded.list(PR))[0].summary, '保留')
})

test('歷史超過上限時只保留最新記錄', async () => {
  const limitedPath = join(directory, 'limited.json')
  const store = await createHistoryStore({ filePath: limitedPath, maxRecords: 2 })
  await store.record(record({ id: 'first' }))
  await store.record(record({ id: 'second' }))
  await store.record(record({ id: 'third' }))
  assert.deepEqual((await store.list(PR)).map(item => item.id), ['third', 'second'])
})

test('historyRecordFromJob 將完成與錯誤事件轉成可保存記錄', () => {
  const job = { id: 'job-1', pr: PR, agent: 'claude', startedAt: '2026-09-16T00:00:00.000Z' }
  const done = historyRecordFromJob(job, {
    kind: 'done',
    result: { ok: true, verdict: 'pass', summary: 'ok', findings: [] },
  })
  assert.equal(done.status, 'completed')
  assert.equal(done.verdict, 'pass')
  const failed = historyRecordFromJob(job, { kind: 'error', message: 'CLI 失敗' })
  assert.equal(failed.status, 'error')
  assert.equal(failed.error, 'CLI 失敗')
})
