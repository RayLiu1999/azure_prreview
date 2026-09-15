import { randomUUID } from 'node:crypto'

export function createJobStore({ maxCompleted = 100 } = {}) {
  if (!Number.isSafeInteger(maxCompleted) || maxCompleted < 1) throw new Error('maxCompleted 必須是正整數')
  const byId = new Map()
  const byKey = new Map()
  function prune() {
    const completed = [...byId.values()].filter(job => job.status !== 'running')
    for (const job of completed.slice(0, Math.max(0, completed.length - maxCompleted))) {
      byId.delete(job.id)
      if (byKey.get(job.key) === job) byKey.delete(job.key)
    }
  }
  function start(key, runFn) {
    const previous = byKey.get(key)
    if (previous?.status === 'running') previous.cancel()
    const subscribers = new Set()
    let handle
    const deliver = (fn, event) => { try { fn(event) } catch {} }
    const job = {
      id: randomUUID(), key, status: 'running', history: [],
      subscribe(fn) {
        for (const event of job.history) deliver(fn, event)
        if (job.status === 'running') subscribers.add(fn)
        return () => subscribers.delete(fn)
      },
      cancel() { handle?.cancel(); emit({ kind: 'error', message: '已取消' }) },
    }
    function emit(event) {
      if (job.status !== 'running') return
      job.history.push(event)
      if (event.kind === 'done' || event.kind === 'error') job.status = event.kind
      for (const fn of [...subscribers]) deliver(fn, event)
      if (job.status !== 'running') { subscribers.clear(); prune() }
    }
    byId.set(job.id, job)
    byKey.set(key, job)
    void (async () => {
      try {
        if (job.status !== 'running') return
        handle = runFn()
        if (job.status !== 'running') { handle.cancel?.(); return }
        for await (const event of handle.events) emit(event)
        if (job.status === 'running') emit({ kind: 'error', message: '執行結束但沒有產生結果' })
      } catch (error) {
        emit({ kind: 'error', message: error.message || String(error) })
      }
    })()
    return job
  }
  return {
    start, find: key => byKey.get(key) || null, get: id => byId.get(id) || null,
    cancelAll() { for (const job of byId.values()) if (job.status === 'running') job.cancel() },
  }
}
