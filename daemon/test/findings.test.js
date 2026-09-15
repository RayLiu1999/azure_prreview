import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFindings } from '../findings.js'

test('行號僅保留安全的正整數', () => {
  for (const line of [0, -1, 1.5, '0', '9007199254740993', true]) {
    const result = parseFindings(JSON.stringify({ findings: [{ file: 'a.js', line }] }))
    assert.equal(result.findings[0].line, null)
  }
})

const valid = {
  summary: '整體結構清楚，有一處需要處理。',
  findings: [
    {
      file: 'src/OrderService.cs',
      line: 42,
      severity: 'major',
      title: '可能的 null reference',
      body: 'customer 在第 38 行可能為 null。',
    },
  ],
}

test('解析乾淨的 JSON', () => {
  const result = parseFindings(JSON.stringify(valid))
  assert.equal(result.ok, true)
  assert.equal(result.summary, '整體結構清楚，有一處需要處理。')
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0].severity, 'major')
})

test('解析包在 markdown code fence 裡的 JSON', () => {
  const wrapped = '這是我的分析：\n\n```json\n' + JSON.stringify(valid) + '\n```\n'
  const result = parseFindings(wrapped)
  assert.equal(result.ok, true)
  assert.equal(result.findings.length, 1)
})

test('解析沒有標語言的 code fence', () => {
  const wrapped = '```\n' + JSON.stringify(valid) + '\n```'
  assert.equal(parseFindings(wrapped).ok, true)
})

test('JSON 前後有 CLI 說明文字仍能解析', () => {
  const wrapped = '審核完成，以下是結果：\n' + JSON.stringify(valid) + '\n工作階段結束。'
  const result = parseFindings(wrapped)
  assert.equal(result.ok, true)
  assert.equal(result.findings.length, 1)
})

test('字串內容含大括號時仍能找出完整 JSON', () => {
  const payload = {
    summary: 's',
    findings: [{ file: 'a.js', title: 't', body: '條件 `{ ready: true }` 需要確認。' }],
  }
  const wrapped = `status\n${JSON.stringify(payload)}\nstatus`
  assert.equal(parseFindings(wrapped).ok, true)
})

test('findings 為空陣列仍算成功', () => {
  const result = parseFindings(JSON.stringify({ summary: '沒問題', findings: [] }))
  assert.equal(result.ok, true)
  assert.deepEqual(result.findings, [])
})

test('line 缺漏時正規化為 null', () => {
  const input = { summary: 's', findings: [{ file: 'a.cs', severity: 'nit', title: 't', body: 'b' }] }
  const result = parseFindings(JSON.stringify(input))
  assert.equal(result.ok, true)
  assert.equal(result.findings[0].line, null)
})

test('line 為字串數字時轉成數字', () => {
  const input = {
    summary: 's',
    findings: [{ file: 'a.cs', line: '42', severity: 'nit', title: 't', body: 'b' }],
  }
  assert.equal(parseFindings(JSON.stringify(input)).findings[0].line, 42)
})

test('未知的 severity 正規化為 minor', () => {
  const input = {
    summary: 's',
    findings: [{ file: 'a.cs', line: 1, severity: '超級嚴重', title: 't', body: 'b' }],
  }
  assert.equal(parseFindings(JSON.stringify(input)).findings[0].severity, 'minor')
})

test('severity 大小寫不敏感', () => {
  const input = {
    summary: 's',
    findings: [{ file: 'a.cs', line: 1, severity: 'BLOCKER', title: 't', body: 'b' }],
  }
  assert.equal(parseFindings(JSON.stringify(input)).findings[0].severity, 'blocker')
})

test('缺少 file 的 finding 被丟棄，其餘保留', () => {
  const input = {
    summary: 's',
    findings: [
      { line: 1, severity: 'nit', title: '沒有 file', body: 'b' },
      { file: 'ok.cs', line: 2, severity: 'nit', title: '正常', body: 'b' },
    ],
  }
  const result = parseFindings(JSON.stringify(input))
  assert.equal(result.ok, true)
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0].title, '正常')
})

test('完全不是 JSON 時降級回傳原始文字', () => {
  const result = parseFindings('我覺得這個 PR 大致上沒問題。')
  assert.equal(result.ok, false)
  assert.equal(result.raw, '我覺得這個 PR 大致上沒問題。')
})

test('是 JSON 但沒有 findings 陣列時降級', () => {
  assert.equal(parseFindings(JSON.stringify({ summary: '只有總結' })).ok, false)
})

test('findings 不是陣列時降級', () => {
  assert.equal(parseFindings(JSON.stringify({ summary: 's', findings: '不是陣列' })).ok, false)
})

test('空字串降級', () => {
  assert.equal(parseFindings('').ok, false)
})

test('非字串輸入降級而不是拋錯', () => {
  assert.equal(parseFindings(undefined).ok, false)
  assert.equal(parseFindings(null).ok, false)
})
