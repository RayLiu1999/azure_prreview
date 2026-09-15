import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from '../server.js'
import { createJobStore } from '../jobs.js'

const TOKEN = 'a'.repeat(64)
const ORIGIN = 'https://dev.azure.com'
const PR = { org: 'contoso', project: 'P', repo: 'r', prId: 1, agent: 'claude' }

function fakeRunFn(events = []) {
  return () => ({
    events: (async function* () {
      for (const event of events) yield event
    })(),
    cancel() {},
  })
}

async function withServer(runFn, fn) {
  const server = createServer({ token: TOKEN, jobStore: createJobStore(), runFn })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await fn(base)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

function post(base, body, token = TOKEN) {
  const headers = { 'Content-Type': 'application/json' }
  if (token !== null) headers['X-PRReview-Token'] = token
  return fetch(`${base}/review`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

test('/health 不需要 token', async () => {
  await withServer(fakeRunFn(), async (base) => {
    const res = await fetch(`${base}/health`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true })
  })
})

test('沒帶 token 的 /review 回 401', async () => {
  await withServer(fakeRunFn(), async (base) => {
    assert.equal((await post(base, PR, null)).status, 401)
  })
})

test('token 錯誤的 /review 回 401', async () => {
  await withServer(fakeRunFn(), async (base) => {
    assert.equal((await post(base, PR, 'b'.repeat(64))).status, 401)
  })
})

test('token 錯誤時不會啟動任何 job', async () => {
  let started = false
  const runFn = () => {
    started = true
    return fakeRunFn()()
  }
  await withServer(runFn, async (base) => {
    await post(base, PR, null)
    assert.equal(started, false)
  })
})

test('token 正確的 /review 回 201 與 jobId', async () => {
  await withServer(fakeRunFn(), async (base) => {
    const res = await post(base, PR)
    assert.equal(res.status, 201)
    assert.match((await res.json()).jobId, /.+/)
  })
})

test('agent 可選 claude 或 codex', async () => {
  const seen = []
  const runFn = (pr, options) => {
    seen.push(options.agent)
    return fakeRunFn([{ kind: 'done', result: { ok: true, summary: '', findings: [] } }])()
  }
  await withServer(runFn, async (base) => {
    assert.equal((await post(base, { ...PR, agent: 'claude' })).status, 201)
    assert.equal((await post(base, { ...PR, agent: 'codex' })).status, 201)
  })
  assert.deepEqual(seen, ['claude', 'codex'])
})

test('未提供 agent 時預設使用 claude', async () => {
  let seen
  const runFn = (pr, options) => {
    seen = options.agent
    return fakeRunFn([{ kind: 'done', result: { ok: true, summary: '', findings: [] } }])()
  }
  await withServer(runFn, async (base) => {
    const { agent, ...withoutAgent } = PR
    assert.equal((await post(base, withoutAgent)).status, 201)
  })
  assert.equal(seen, 'claude')
})

test('未知 agent 回 400 且不啟動 job', async () => {
  let started = false
  const runFn = () => {
    started = true
    return fakeRunFn()()
  }
  await withServer(runFn, async (base) => {
    assert.equal((await post(base, { ...PR, agent: 'other' })).status, 400)
  })
  assert.equal(started, false)
})

test('缺欄位的 /review 回 400', async () => {
  await withServer(fakeRunFn(), async (base) => {
    assert.equal((await post(base, { org: 'contoso' })).status, 400)
  })
})

test('prId 非正整數的 /review 回 400', async () => {
  await withServer(fakeRunFn(), async (base) => {
    assert.equal((await post(base, { ...PR, prId: 0 })).status, 400)
    assert.equal((await post(base, { ...PR, prId: '1' })).status, 400)
  })
})

test('壞掉的 JSON body 回 400 而不是讓 server 掛掉', async () => {
  await withServer(fakeRunFn(), async (base) => {
    assert.equal((await post(base, '{ 壞掉的')).status, 400)
    assert.equal((await fetch(`${base}/health`)).status, 200)
  })
})

test('OPTIONS 預檢回 204 並帶 CORS 標頭', async () => {
  await withServer(fakeRunFn(), async (base) => {
    const res = await fetch(`${base}/review`, {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' },
    })
    assert.equal(res.status, 204)
    assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN)
    assert.match(res.headers.get('access-control-allow-headers'), /X-PRReview-Token/i)
  })
})

test('visualstudio.com Azure DevOps origin 也能通過 CORS', async () => {
  await withServer(fakeRunFn(), async (base) => {
    const res = await fetch(`${base}/health`, { headers: { Origin: 'https://kingnetrd.visualstudio.com' } })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://kingnetrd.visualstudio.com')
  })
})

test('非白名單 origin 不會拿到 CORS 放行標頭', async () => {
  await withServer(fakeRunFn(), async (base) => {
    const res = await fetch(`${base}/health`, { headers: { Origin: 'https://evil.example' } })
    assert.equal(res.headers.get('access-control-allow-origin'), null)
  })
})

test('SSE 推送事件並在結束時關閉', async () => {
  const runFn = fakeRunFn([
    { kind: 'tool', tool: 'repo_pull_request', detail: '' },
    { kind: 'done', result: { ok: true, summary: '沒問題', findings: [] } },
  ])
  await withServer(runFn, async (base) => {
    const { jobId } = await (await post(base, PR)).json()

    const res = await fetch(`${base}/jobs/${jobId}/events`, {
      headers: { 'X-PRReview-Token': TOKEN },
    })
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /text\/event-stream/)

    let text = ''
    const decoder = new TextDecoder()
    for await (const chunk of res.body) text += decoder.decode(chunk, { stream: true })

    assert.match(text, /"kind":"tool"/)
    assert.match(text, /"kind":"done"/)
  })
})

test('不存在的 jobId 回 404', async () => {
  await withServer(fakeRunFn(), async (base) => {
    const res = await fetch(`${base}/jobs/does-not-exist/events`, {
      headers: { 'X-PRReview-Token': TOKEN },
    })
    assert.equal(res.status, 404)
  })
})

test('SSE 也需要 token', async () => {
  await withServer(fakeRunFn(), async (base) => {
    assert.equal((await fetch(`${base}/jobs/whatever/events`)).status, 401)
  })
})

test('未知路徑回 404', async () => {
  await withServer(fakeRunFn(), async (base) => {
    const res = await fetch(`${base}/nope`, { headers: { 'X-PRReview-Token': TOKEN } })
    assert.equal(res.status, 404)
  })
})
