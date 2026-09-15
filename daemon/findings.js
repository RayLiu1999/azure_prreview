const SEVERITIES = new Set(['blocker', 'major', 'minor', 'nit'])
const FENCE = /```(?:json)?\s*([\s\S]*?)```/

function extractJson(text) {
  const fenced = text.match(FENCE)
  const candidate = fenced ? fenced[1] : text
  try {
    return JSON.parse(candidate.trim())
  } catch {
    return null
  }
}

function normalizeLine(value) {
  const number = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

function normalizeSeverity(value) {
  if (typeof value !== 'string') return 'minor'
  const lower = value.toLowerCase()
  return SEVERITIES.has(lower) ? lower : 'minor'
}

function normalizeFinding(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.file !== 'string' || !raw.file) return null
  return {
    file: raw.file,
    line: normalizeLine(raw.line),
    severity: normalizeSeverity(raw.severity),
    title: typeof raw.title === 'string' ? raw.title : '',
    body: typeof raw.body === 'string' ? raw.body : '',
  }
}

export function parseFindings(text) {
  const raw = typeof text === 'string' ? text : ''
  const parsed = extractJson(raw)
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.findings)) {
    return { ok: false, raw }
  }
  return {
    ok: true,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    findings: parsed.findings.map(normalizeFinding).filter(Boolean),
  }
}
