import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const DEFAULT_HISTORY_LIMIT = 100
export const DEFAULT_HISTORY_FILE = 'history.json'

const MAX_TEXT_LENGTH = 16_384
const MAX_FINDINGS = 200
const MAX_HISTORY_QUERY_LIMIT = 100
const AGENTS = new Set(['claude', 'codex'])
const STATUSES = new Set(['completed', 'error'])
const VERDICTS = new Set(['pass', 'needs_changes'])

function boundedText(value, max = MAX_TEXT_LENGTH) {
  if (typeof value !== 'string') return ''
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function validPr(pr) {
  return Boolean(
    pr &&
      typeof pr.org === 'string' && pr.org.trim() && pr.org.length <= 256 && !/[\x00-\x1f\x7f/\\]/.test(pr.org) &&
      typeof pr.project === 'string' && pr.project.trim() && pr.project.length <= 256 && !/[\x00-\x1f\x7f/\\]/.test(pr.project) &&
      typeof pr.repo === 'string' && pr.repo.trim() && pr.repo.length <= 256 && !/[\x00-\x1f\x7f/\\]/.test(pr.repo) &&
      Number.isSafeInteger(pr.prId) && pr.prId > 0
  )
}

function normalizeFinding(value) {
  if (!value || typeof value !== 'object' || typeof value.file !== 'string' || !value.file) return null
  return {
    file: boundedText(value.file, 1024),
    line: Number.isSafeInteger(value.line) && value.line > 0 ? value.line : null,
    severity: ['blocker', 'major', 'minor', 'nit'].includes(value.severity) ? value.severity : 'minor',
    title: boundedText(value.title, 2048),
    body: boundedText(value.body),
  }
}

export function normalizeHistoryRecord(value) {
  if (!value || typeof value !== 'object' || !validPr(value.pr)) return null
  if (!AGENTS.has(value.agent) || !STATUSES.has(value.status)) return null

  const findings = Array.isArray(value.findings)
    ? value.findings.map(normalizeFinding).filter(Boolean).slice(0, MAX_FINDINGS)
    : []
  const verdict = VERDICTS.has(value.verdict) ? value.verdict : null
  return {
    id: typeof value.id === 'string' && value.id ? value.id : randomUUID(),
    pr: {
      org: boundedText(value.pr.org, 256),
      project: boundedText(value.pr.project, 256),
      repo: boundedText(value.pr.repo, 256),
      prId: value.pr.prId,
    },
    agent: value.agent,
    status: value.status,
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : null,
    completedAt: typeof value.completedAt === 'string' ? value.completedAt : new Date().toISOString(),
    verdict,
    summary: boundedText(value.summary),
    findings,
    raw: boundedText(value.raw),
    error: boundedText(value.error, 4096),
  }
}

export function historyRecordFromJob(job, event) {
  const result = event?.kind === 'done' && event.result && typeof event.result === 'object'
    ? event.result
    : {}
  return normalizeHistoryRecord({
    id: job?.id,
    pr: job?.pr,
    agent: job?.agent,
    status: event?.kind === 'done' ? 'completed' : 'error',
    startedAt: job?.startedAt,
    completedAt: new Date().toISOString(),
    verdict: result.verdict,
    summary: result.summary,
    findings: result.findings,
    raw: result.raw,
    error: event?.kind === 'error' ? event.message : '',
  })
}

function samePr(record, pr) {
  return record.pr.org === pr.org &&
    record.pr.project === pr.project &&
    record.pr.repo === pr.repo &&
    record.pr.prId === pr.prId
}

function newestFirst(left, right) {
  const leftTime = Date.parse(left.completedAt || left.startedAt || '')
  const rightTime = Date.parse(right.completedAt || right.startedAt || '')
  return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0)
}

export async function createHistoryStore({
  filePath,
  configDir,
  maxRecords = DEFAULT_HISTORY_LIMIT,
} = {}) {
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) throw new Error('maxRecords 必須是正整數')
  const target = filePath || join(configDir || process.cwd(), DEFAULT_HISTORY_FILE)
  const state = { records: [], writeChain: Promise.resolve() }

  async function load() {
    try {
      const content = await readFile(target, 'utf8')
      const parsed = JSON.parse(content)
      state.records = Array.isArray(parsed)
        ? parsed.map(normalizeHistoryRecord).filter(Boolean).sort(newestFirst).slice(0, maxRecords)
        : []
    } catch (error) {
      if (error?.code !== 'ENOENT') state.records = []
    }
  }

  async function persist() {
    const payload = `${JSON.stringify(state.records, null, 2)}\n`
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
    await mkdir(dirname(target), { recursive: true })
    try {
      await writeFile(temporary, payload, { encoding: 'utf8', mode: 0o600, flag: 'w' })
      await rename(temporary, target)
    } finally {
      await rm(temporary, { force: true }).catch(() => {})
    }
  }

  function queuePersist() {
    state.writeChain = state.writeChain.then(persist, persist).catch(() => {})
    return state.writeChain
  }

  await load()

  return {
    filePath: target,
    async record(value) {
      const record = normalizeHistoryRecord(value)
      if (!record) throw new Error('歷史記錄格式無效')
      state.records = [record, ...state.records.filter(item => item.id !== record.id)].sort(newestFirst).slice(0, maxRecords)
      await queuePersist()
      return { ...record, pr: { ...record.pr }, findings: record.findings.map(finding => ({ ...finding })) }
    },
    async list(pr, { limit = maxRecords } = {}) {
      if (!validPr(pr)) return []
      const safeLimit = Number.isSafeInteger(limit)
        ? Math.max(1, Math.min(MAX_HISTORY_QUERY_LIMIT, limit))
        : maxRecords
      return state.records
        .filter(record => samePr(record, pr))
        .slice(0, Math.min(MAX_HISTORY_QUERY_LIMIT, safeLimit))
        .map(record => ({ ...record, pr: { ...record.pr }, findings: record.findings.map(finding => ({ ...finding })) }))
    },
    async flush() {
      await state.writeChain
    },
  }
}
