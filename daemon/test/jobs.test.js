import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createJobStore } from '../jobs.js'

function fakeRun(events) {
  return () => ({
    events: (async function* () {
      for (const event of events) yield event
    })(),
    cancel() {},
  })
}

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

test('start 回傳的 job 一開始是 running', () => {
  const store = createJobStore()
  const job = store.start('pr-1', fakeRun([]))
  assert.equal(job.status, 'running')
  assert.match(job.id, /.+/)
})

test('job 跑完後 status 變 done 且事件進入 history', async () => {
  const store = createJobStore()
  const job = store.start(
    'pr-1',
    fakeRun([
      { kind: 'tool', tool: 'repo_file', detail: 'a.cs' },
      { kind: 'done', result: { ok: true, summary: 's', findings: [] } },
    ])
  )
  await settle()
  assert.equal(job.status, 'done')
  assert.equal(job.history.length, 2)
})

test('收到 error 事件後 status 變 error', async () => {
  const store = createJobStore()
  const job = store.start('pr-1', fakeRun([{ kind: 'error', message: '壞了' }]))
  await settle()
  assert.equal(job.status, 'error')
})

test('沒有產生任何結尾事件時補一個 error', async () => {
  const store = createJobStore()
  const job = store.start('pr-1', fakeRun([{ kind: 'text', text: '只有這個' }]))
  await settle()
  assert.equal(job.status, 'error')
  assert.equal(job.history.at(-1).kind, 'error')
})

test('執行中拋錯會轉成 error 事件而不是未捕捉例外', async () => {
  const store = createJobStore()
  const job = store.start('pr-1', () => ({
    events: (async function* () {
      throw new Error('爆了')
    })(),
    cancel() {},
  }))
  await settle()
  assert.equal(job.status, 'error')
  assert.match(job.history.at(-1).message, /爆了/)
})

test('訂閱者會收到後續事件', async () => {
  const store = createJobStore()
  const job = store.start('pr-1', fakeRun([{ kind: 'text', text: 'hi' }]))
  const seen = []
  job.subscribe((event) => seen.push(event))
  await settle()
  assert.equal(seen[0].text, 'hi')
})

test('晚到的訂閱者會補收到歷史事件', async () => {
  const store = createJobStore()
  const job = store.start(
    'pr-1',
    fakeRun([
      { kind: 'text', text: '第一則' },
      { kind: 'done', result: { ok: true, summary: '', findings: [] } },
    ])
  )
  await settle()
  const seen = []
  job.subscribe((event) => seen.push(event))
  assert.equal(seen.length, 2)
  assert.equal(seen[0].text, '第一則')
})

test('取消訂閱後不再收到事件', async () => {
  const store = createJobStore()
  let release
  const job = store.start('pr-1', () => ({
    events: (async function* () {
      yield { kind: 'text', text: '第一則' }
      await new Promise((resolve) => {
        release = resolve
      })
      yield { kind: 'text', text: '第二則' }
    })(),
    cancel() {},
  }))
  const seen = []
  const unsubscribe = job.subscribe((event) => seen.push(event))
  await settle()
  unsubscribe()
  release()
  await settle()
  assert.equal(seen.length, 1)
})

test('find 以 key 取回既有 job', () => {
  const store = createJobStore()
  const job = store.start('pr-1', fakeRun([]))
  assert.equal(store.find('pr-1'), job)
  assert.equal(store.find('pr-2'), null)
})

test('同一個 key 再次 start 會取代舊 job', () => {
  const store = createJobStore()
  const first = store.start('pr-1', fakeRun([]))
  const second = store.start('pr-1', fakeRun([]))
  assert.notEqual(first.id, second.id)
  assert.equal(store.find('pr-1'), second)
})

test('訂閱者拋錯不會拖垮其他訂閱者', async () => {
  const store = createJobStore()
  const job = store.start('pr-1', fakeRun([{ kind: 'text', text: 'hi' }]))
  job.subscribe(() => {
    throw new Error('訂閱者爆了')
  })
  const seen = []
  job.subscribe((event) => seen.push(event))
  await settle()
  assert.equal(seen.length, 2)
  assert.equal(seen[0].text, 'hi')
  assert.equal(seen[1].kind, 'error')
})

test('terminal event 會通知完成回呼並帶出 PR metadata', async () => {
  const completed = []
  const store = createJobStore()
  const job = store.start(
    'pr-1',
    fakeRun([{ kind: 'done', result: { ok: true, verdict: 'pass', summary: 's', findings: [] } }]),
    { pr: { org: 'o', project: 'p', repo: 'r', prId: 1 }, agent: 'claude', onTerminal: (value, event) => completed.push({ value, event }) }
  )
  await settle()
  assert.equal(job.status, 'done')
  assert.equal(completed.length, 1)
  assert.equal(completed[0].value.pr.prId, 1)
  assert.equal(completed[0].event.kind, 'done')
})
