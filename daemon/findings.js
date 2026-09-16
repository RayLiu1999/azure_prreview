const SEVERITIES = new Set(['blocker', 'major', 'minor', 'nit'])
const VERDICTS = new Set(['pass', 'needs_changes'])
const FENCE = /```(?:json)?\s*([\s\S]*?)```/

function isFindingsPayload(value) {
  return Boolean(value && typeof value === 'object' && Array.isArray(value.findings))
}

function parseCandidate(candidate) {
  try {
    const value = JSON.parse(candidate.trim())
    return isFindingsPayload(value) ? value : null
  } catch {
    return null
  }
}

// Claude occasionally adds a short status line or terminal decoration around
// the final JSON even though the prompt asks for JSON only. Find the first
// balanced object that matches the review payload without executing anything.
function findPayloadObject(text) {
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]

    if (start < 0) {
      if (character === '{') {
        start = index
        depth = 1
      }
      continue
    }

    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }

    if (character === '"') inString = true
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) {
        const payload = parseCandidate(text.slice(start, index + 1))
        if (payload) return payload
        start = -1
      }
    }
  }

  return null
}

function extractJson(text) {
  const fenced = text.match(FENCE)
  if (fenced) {
    const payload = parseCandidate(fenced[1])
    if (payload) return payload
  }

  const payload = parseCandidate(text)
  return payload || findPayloadObject(text)
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

export function determineVerdict(findings) {
  return findings.some(finding => finding.severity === 'blocker' || finding.severity === 'major')
    ? 'needs_changes'
    : 'pass'
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
  if (!parsed) {
    return { ok: false, raw }
  }
  const normalized = parsed.findings.map(normalizeFinding)
  const findings = normalized.filter(Boolean)
  const hasInvalidFinding = findings.length !== parsed.findings.length
  const suppliedVerdict = typeof parsed.verdict === 'string' ? parsed.verdict.toLowerCase() : null
  const verdict = hasInvalidFinding
    ? null
    : suppliedVerdict && VERDICTS.has(suppliedVerdict)
      ? determineVerdict(findings)
      : null
  return {
    ok: true,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    verdict,
    findings,
  }
}
