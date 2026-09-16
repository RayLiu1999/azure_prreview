import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SEVERITY_META, VERDICT_META } from '../sidebar.js'

test('severity 都有中文標籤與清楚說明', () => {
  assert.deepEqual(Object.keys(SEVERITY_META), ['blocker', 'major', 'minor', 'nit'])
  for (const meta of Object.values(SEVERITY_META)) {
    assert.ok(meta.label)
    assert.ok(meta.description)
  }
  assert.equal(SEVERITY_META.blocker.label, '阻擋合併')
  assert.equal(SEVERITY_META.major.label, '重大問題')
  assert.equal(SEVERITY_META.minor.label, '次要問題')
  assert.equal(SEVERITY_META.nit.label, '格式建議')
})

test('verdict 有可通過與需修改兩種中文呈現', () => {
  assert.equal(VERDICT_META.pass.label, '目前 PR 可通過')
  assert.equal(VERDICT_META.needs_changes.label, '需要修改後再通過')
  assert.notEqual(VERDICT_META.pass.className, VERDICT_META.needs_changes.className)
})
