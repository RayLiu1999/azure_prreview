import { createServer as createHttpServer } from 'node:http'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tokenMatches, loadOrCreateToken } from './auth.js'
import { createJobStore } from './jobs.js'
import { runReview, checkAgentAvailable } from './runner.js'

export function allowedOrigin(origin) {
  return origin === 'https://dev.azure.com' || /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.visualstudio\.com$/.test(origin || '')
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 16_384) throw new Error('body 過大')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('body 不是合法 JSON') }
}

export function validReviewRequest(body) {
  if (!body || typeof body !== 'object') return null
  const { org, project, repo, prId, agent = 'claude' } = body
  if (![org, project, repo].every(v => typeof v === 'string' && v.trim() && v.length <= 256 && !/[\x00-\x1f\x7f/\\]/.test(v))) return null
  if (!Number.isSafeInteger(prId) || prId < 1 || !['claude', 'codex'].includes(agent)) return null
  return { pr: { org, project, repo, prId }, agent }
}

export function createServer({ token, jobStore = createJobStore(), runFn = runReview }) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('server token 格式無效')
  const server = createHttpServer(async (req, res) => {
    try {
      const origin = req.headers.origin
      res.setHeader('Vary', 'Origin')
      if (allowedOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-PRReview-Token')
        if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true')
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(allowedOrigin(origin) ? 204 : 403); res.end(); return
      }
      const url = new URL(req.url, 'http://127.0.0.1')
      if (req.method === 'GET' && url.pathname === '/health') { json(res, 200, { ok: true }); return }
      // Authenticate before parsing a body or starting work.
      if (!tokenMatches(token, req.headers['x-prreview-token'])) { json(res, 401, { error: 'token 無效或未提供' }); return }
      if (origin && !allowedOrigin(origin)) { json(res, 403, { error: '不允許的來源' }); return }
      if (req.method === 'GET' && url.pathname === '/auth') { json(res, 200, { ok: true }); return }
      if (req.method === 'POST' && url.pathname === '/review') {
        let body
        try { body = await readBody(req) } catch (error) { json(res, 400, { error: error.message }); return }
        const request = validReviewRequest(body)
        if (!request) { json(res, 400, { error: '需要 org / project / repo / prId，agent 只能是 claude 或 codex' }); return }
        const { pr, agent } = request
        const key = JSON.stringify([agent, pr.org, pr.project, pr.repo, pr.prId])
        const running = jobStore.find(key)
        const job = running?.status === 'running' ? running : jobStore.start(key, () => runFn(pr, { agent }))
        json(res, 201, { jobId: job.id }); return
      }
      const match = url.pathname.match(/^\/jobs\/([a-zA-Z0-9-]+)\/events$/)
      if (req.method === 'GET' && match) {
        const job = jobStore.get(match[1])
        if (!job) { json(res, 404, { error: '找不到這個 job' }); return }
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
        res.flushHeaders()
        let unsubscribe = () => {}
        let heartbeat
        let closed = false
        const finish = () => {
          if (closed) return
          closed = true; clearInterval(heartbeat); unsubscribe(); res.end()
        }
        res.on('close', finish)
        unsubscribe = job.subscribe(event => {
          if (closed) return
          res.write(`data: ${JSON.stringify(event)}\n\n`)
          if (event.kind === 'done' || event.kind === 'error') finish()
        })
        if (closed) unsubscribe()
        else heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000)
        return
      }
      json(res, 404, { error: '找不到這個路徑' })
    } catch {
      if (!res.headersSent) json(res, 500, { error: 'daemon 處理請求失敗' })
      else res.end()
    }
  })
  server.on('close', () => jobStore.cancelAll())
  return server
}

export async function main() {
  const port = Number(process.env.PRREVIEW_PORT || 7797)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PRREVIEW_PORT 必須介於 1 與 65535')
  const claudePath = process.env.PRREVIEW_CLAUDE || 'claude'
  const codexPath = process.env.PRREVIEW_CODEX || 'codex'
  const token = await loadOrCreateToken(process.env.PRREVIEW_CONFIG_DIR || join(homedir(), '.prreview'))
  const store = createJobStore()
  const server = createServer({ token, jobStore: store, runFn: (pr, { agent }) => runReview(pr, { agent, claudePath, codexPath }) })
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done) })
  console.log(`prreview daemon：http://127.0.0.1:${port}`)
  console.log(`token：${token}`)
  for (const [agent, path] of [['claude', claudePath], ['codex', codexPath]]) {
    console.log(`${agent}：${await checkAgentAvailable(agent, path) ? '可用' : '未找到，請設定執行檔路徑'}`)
  }
  const stop = () => { store.cancelAll(); server.close(); server.closeAllConnections() }
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  return server
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
