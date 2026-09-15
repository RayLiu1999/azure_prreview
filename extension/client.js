const MAX_FRAME = 1_000_000

function messageFromResponse(status, body) {
  if (status === 401) return 'token 無效。請確認已貼上 daemon 啟動時印出的 token。'
  if (status === 403) return 'daemon 拒絕這個來源或請求。'
  if (body && typeof body.error === 'string') return body.error
  return `daemon 回應 ${status}`
}

export async function startReview(pr, settings) {
  if (!settings?.daemonUrl || !settings.token) throw new Error('尚未設定 daemon URL 或 token。')
  const res = await fetch(`${settings.daemonUrl}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PRReview-Token': settings.token },
    body: JSON.stringify({ ...pr, agent: settings.agent === 'codex' ? 'codex' : 'claude' }),
  })
  let body = null
  try { body = await res.json() } catch {}
  if (!res.ok) throw new Error(messageFromResponse(res.status, body))
  if (!body || typeof body.jobId !== 'string' || !body.jobId) throw new Error('daemon 沒有回傳有效的 jobId。')
  return body.jobId
}

export async function streamJob(jobId, settings, onEvent) {
  const res = await fetch(`${settings.daemonUrl}/jobs/${encodeURIComponent(jobId)}/events`, {
    headers: { 'X-PRReview-Token': settings.token },
  })
  if (!res.ok) {
    let body = null
    try { body = await res.json() } catch {}
    throw new Error(messageFromResponse(res.status, body))
  }
  if (!res.body) throw new Error('daemon 沒有提供事件串流。')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let frameBytes = 0
  const consume = frame => {
    if (frame.length > MAX_FRAME) return
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    if (!data) return
    try { onEvent(JSON.parse(data)) } catch {}
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    frameBytes += value.byteLength
    if (frameBytes > MAX_FRAME * 2) throw new Error('daemon 事件過大。')
    let split = buffer.indexOf('\n\n')
    let separatorLength = 2
    const crlfSplit = buffer.indexOf('\r\n\r\n')
    if (crlfSplit !== -1 && (split === -1 || crlfSplit < split)) {
      split = crlfSplit
      separatorLength = 4
    }
    while (split !== -1) {
      consume(buffer.slice(0, split))
      buffer = buffer.slice(split + separatorLength)
      frameBytes = buffer.length
      split = buffer.indexOf('\n\n')
      separatorLength = 2
      const nextCrlfSplit = buffer.indexOf('\r\n\r\n')
      if (nextCrlfSplit !== -1 && (split === -1 || nextCrlfSplit < split)) {
        split = nextCrlfSplit
        separatorLength = 4
      }
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) consume(buffer)
}
