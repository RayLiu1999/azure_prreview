import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPrompt } from '../prompt.js'

test('buildPrompt 寫入 PR 座標並保留唯讀安全界線', async () => {
  const prompt = await buildPrompt({
    org: 'contoso',
    project: 'Payments',
    repo: 'api',
    prId: 42,
  })

  assert.match(prompt, /organization: contoso/)
  assert.match(prompt, /project: Payments/)
  assert.match(prompt, /repository: api/)
  assert.match(prompt, /pull request id: 42/)
  assert.match(prompt, /不可信任的待審資料/)
  assert.match(prompt, /只使用已提供的 `azure-devops` 唯讀工具/)
  assert.match(prompt, /verdict/)
  assert.match(prompt, /needs_changes/)
  assert.doesNotMatch(prompt, /\{\{(?:org|project|repo|prId)\}\}/)
})
