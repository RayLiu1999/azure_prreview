import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { checkConnection, startReview, streamJob } from '../client.js'

const settings = { daemonUrl: 'http://127.0.0.1:7797', token: 't'.repeat(64), agent: 'claude' }
const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

test('startReview 傳送 PR 座標與 token，並回傳 jobId', async () => {
  let request
  globalThis.fetch = async (url, init) => {
    request = { url, init }
    return new Response(JSON.stringify({ jobId: 'job-1' }), { status: 201, headers: { 'Content-Type': 'application/json' } })
  }
  const jobId = await startReview({ org: 'o', project: 'p', repo: 'r', prId: 7 }, settings)
  assert.equal(jobId, 'job-1')
  assert.equal(request.init.headers['X-PRReview-Token'], settings.token)
  assert.deepEqual(JSON.parse(request.init.body), { org: 'o', project: 'p', repo: 'r', prId: 7, agent: 'claude' })
})

test('startReview 將 daemon 錯誤轉成可讀訊息', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: '壞請求' }), { status: 400 })
  await assert.rejects(() => startReview({}, settings), /壞請求/)
  globalThis.fetch = async () => new Response('{}', { status: 401 })
  await assert.rejects(() => startReview({}, settings), /token 無效/)
})

test('checkConnection 傳送 token 並驗證 daemon', async () => {
  let request
  globalThis.fetch = async (url, init) => {
    request = { url, init }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  assert.equal(await checkConnection(settings), true)
  assert.equal(request.url, `${settings.daemonUrl}/auth`)
  assert.equal(request.init.headers['X-PRReview-Token'], settings.token)
})

test('checkConnection 回報 token 或 daemon 錯誤', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'token 無效或未提供' }), { status: 401 })
  await assert.rejects(() => checkConnection(settings), /token 無效/)
  await assert.rejects(() => checkConnection({ ...settings, token: '' }), /請先填入 daemon URL 與 token/)
})

test('streamJob 解析分段 SSE、CRLF 與壞 frame', async () => {
  const chunks = [
    'data: {"kind":"tool","tool":"repo_file"}\r\n\r\n',
    'data: not json\n\n',
    'event: ignored\ndata: {"kind":"done","result":{"ok":true}}\n\n',
  ]
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
      controller.close()
    },
  })
  globalThis.fetch = async () => new Response(stream, { status: 200 })
  const events = []
  await streamJob('job/1', settings, event => events.push(event))
  assert.deepEqual(events, [
    { kind: 'tool', tool: 'repo_file' },
    { kind: 'done', result: { ok: true } },
  ])
})

test('streamJob 將 SSE HTTP 錯誤轉成可讀訊息', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: '找不到 job' }), { status: 404 })
  await assert.rejects(() => streamJob('missing', settings, () => {}), /找不到 job/)
})
