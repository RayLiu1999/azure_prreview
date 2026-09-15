import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseStreamEvent } from '../stream.js'

test('空行回傳 null', () => {
  assert.equal(parseStreamEvent(''), null)
  assert.equal(parseStreamEvent('   '), null)
})

test('非 JSON 的行回傳 null 而不是拋錯', () => {
  assert.equal(parseStreamEvent('not json at all'), null)
  assert.equal(parseStreamEvent('{ 壞掉的 json'), null)
})

test('tool_use 事件解析出工具名稱與目標檔案', () => {
  const line = JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          name: 'mcp__azure-devops__repo_file',
          input: { path: 'src/Services/OrderService.cs' },
        },
      ],
    },
  })
  assert.deepEqual(parseStreamEvent(line), {
    kind: 'tool',
    tool: 'repo_file',
    detail: 'src/Services/OrderService.cs',
  })
})

test('tool_use 的 mcp 前綴被剝掉', () => {
  const line = JSON.stringify({
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', name: 'mcp__azure-devops__repo_pull_request', input: {} }],
    },
  })
  assert.equal(parseStreamEvent(line).tool, 'repo_pull_request')
})

test('tool_use 沒有可辨識的目標時 detail 為空字串', () => {
  const line = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Read', input: {} }] },
  })
  assert.deepEqual(parseStreamEvent(line), { kind: 'tool', tool: 'Read', detail: '' })
})

test('detail 依序從 path / file_path / query 取值', () => {
  const make = (input) =>
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'X', input }] },
    })
  assert.equal(parseStreamEvent(make({ file_path: 'a.cs' })).detail, 'a.cs')
  assert.equal(parseStreamEvent(make({ query: 'OrderService' })).detail, 'OrderService')
  assert.equal(parseStreamEvent(make({ path: 'p.cs', file_path: 'f.cs' })).detail, 'p.cs')
})

test('assistant 的文字內容解析為 text 事件', () => {
  const line = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: '正在檢查 null 處理' }] },
  })
  assert.deepEqual(parseStreamEvent(line), { kind: 'text', text: '正在檢查 null 處理' })
})

test('同一則訊息同時有文字與工具呼叫時，工具優先', () => {
  const line = JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: '我先看一下這個檔案' },
        { type: 'tool_use', name: 'Read', input: { path: 'a.cs' } },
      ],
    },
  })
  assert.equal(parseStreamEvent(line).kind, 'tool')
})

test('result 事件帶出最終文字與錯誤旗標', () => {
  const line = JSON.stringify({
    type: 'result',
    subtype: 'success',
    result: '{"findings":[]}',
    is_error: false,
  })
  assert.deepEqual(parseStreamEvent(line), {
    kind: 'result',
    text: '{"findings":[]}',
    isError: false,
  })
})

test('失敗的 result 事件 isError 為 true', () => {
  const line = JSON.stringify({ type: 'result', result: '出事了', is_error: true })
  assert.equal(parseStreamEvent(line).isError, true)
})

test('不認識的事件型別回傳 null', () => {
  assert.equal(parseStreamEvent(JSON.stringify({ type: 'system', subtype: 'init' })), null)
  assert.equal(parseStreamEvent(JSON.stringify({ type: '未來才會有的型別' })), null)
})

test('結構殘缺的事件回傳 null 而不是拋錯', () => {
  assert.equal(parseStreamEvent(JSON.stringify({ type: 'assistant' })), null)
  assert.equal(parseStreamEvent(JSON.stringify({ type: 'assistant', message: {} })), null)
  assert.equal(parseStreamEvent(JSON.stringify({ type: 'assistant', message: { content: [] } })), null)
  assert.equal(parseStreamEvent(JSON.stringify({ type: 'result' })), null)
})
