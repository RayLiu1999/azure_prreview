# prreview M1 垂直切片 Implementation Plan

> **For agentic workers:** Claude Code 若有 superpowers，使用 `subagent-driven-development`（建議）或 `executing-plans`；Codex 直接依 Task 1 → 10（含 Task 5A）逐項執行與驗證。兩者都必須更新 checkbox，且不得跳過失敗路徑與手動驗收。

**Goal:** 在 Azure DevOps PR 頁面選擇 Claude 或 Codex 後按一下，右側面板即時顯示所選 Agent 產生的結構化 review findings。

**Architecture:** 瀏覽器插件（MV3）的 content script 解析 PR 網址，直連本機 Node daemon；daemon 以 token 驗證後，依請求選擇 `claude -p --output-format stream-json` 或 `codex exec --json --ephemeral --sandbox read-only`，把兩種 CLI 的串流事件正規化成共同進度事件，再經 SSE 推回面板。全程唯讀，不寫入 PR。

**Tech Stack:** Manifest V3（純 HTML/CSS/JS，無建置工具）、Node.js（無第三方相依）、`node --test`、Claude Code CLI 或 Codex CLI、`azure-devops` MCP。

**Spec:** `prreview/docs/superpowers/specs/2026-09-15-prreview-design.md`

## 實作進度（2026-09-15）

- Task 1–4 已完成，包含測試與邊界處理。
- Task 5 Claude prompt／執行器已完成；實際 Claude 審核因帳號 session 額度不足而回報錯誤。
- Task 5A–7 的程式實作與自動測試已完成：Codex 隔離 provider、job store、HTTP/SSE server 與失敗路徑測試；Codex MCP 白名單讀取核准策略已補上。
- Task 8–9 的程式實作與自動測試已完成：插件外殼、Shadow DOM 側邊欄、Visual Studio 網址支援、daemon client 與 SSE 串接。
- Task 10 README 已完成；瀏覽器手動驗收仍待實機操作。
- 真實 Codex PR 67066 唯讀審核已完成：讀取 PR、5 個變更檔案、`CLAUDE.md` 與相關呼叫端／測試，共 51 個 MCP 事件，findings 為空。
- 驗證：daemon `node --test` 75/75、extension `node --test` 18/18，JavaScript 語法與 JSON manifest／schema 檢查通過。
- Git 已移至 `prreview/.git`；父層 `Extension/.git` 的原始 metadata 保存在 `prreview/.git/legacy-extension.git`，未改寫原歷史。

## Global Constraints

- **零第三方相依**：daemon 與 extension 都不得引入 npm 套件。只用 Node 內建模組與瀏覽器原生 API。
- **ESM**：`package.json` 設 `"type": "module"`；一律用 `import` / `export`，不得用 `require`。
- **測試指令**：`node --test`（在 `prreview/daemon/` 與 `prreview/extension/` 各自執行）。與 `devkit/` 慣例一致。
- **daemon 只監聽 `127.0.0.1`**，絕不監聽 `0.0.0.0`。
- **token 驗證必須在任何副作用之前**：路由處理的第一件事就是驗 token，失敗直接回 401。
- **Agent 列舉值**：全專案只接受 `claude` / `codex`，預設 `claude`；未知值回 400，且不得啟動 process。
- **Codex 必須隔離設定**：review process 使用 `--ignore-user-config`，只重新注入 `azure-devops` MCP 的唯讀工具，並使用 `--sandbox read-only`。不能只靠 prompt 宣稱唯讀。
- **Codex MCP 非互動核准**：隔離設定對白名單 server 使用 `default_tools_approval_mode = "approve"`；因為 server 只暴露五個讀取工具，所以不會擴大 PR 或本機寫入能力。
- **不要求兩個 CLI 同時存在**：只要所選 Agent 可執行且已設定 `azure-devops` MCP 即可；缺少另一個不影響 review。
- **平台限定** Azure DevOps Cloud：`dev.azure.com` 與 `*.visualstudio.com`；不支援自架 Server。
- **commit 格式**：`<type>(<scope>): <subject> [no-issue]`，scope 一律為 `prreview`，訊息用繁體中文。
- **M1 不實作**：發 PR 留言、獨立設定頁 UI、自訂 prompt、結果快取、取消按鈕。Agent 下拉選單屬於核心流程，直接放在側邊欄。
- **severity 列舉值**（全專案一致，不得自創）：`blocker` / `major` / `minor` / `nit`。

---

## File Structure

```
prreview/
  daemon/
    package.json       Node 專案宣告（type: module、start/test script）
    auth.js            token 產生、讀寫、比對          ← 純函式 + 檔案 I/O
    stream.js          claude stream-json → 進度事件    ← 純函式
    codex.js           Codex 隔離設定、JSONL 解析與執行  ← provider adapter
    findings.js        findings JSON 驗證與正規化       ← 純函式
    runner.js          選擇 provider、組 prompt          ← provider facade
    jobs.js            job 生命週期與訂閱者管理
    server.js          HTTP 路由、CORS、token 驗證、SSE  ← 唯一接觸網路
    prompts/review.md  內建審核 prompt
    prompts/findings.schema.json  Codex 結構化輸出 schema
    test/              auth / stream / codex / findings / jobs / server 各一支
  extension/
    manifest.json
    prurl.js           PR URL 解析                      ← 純函式，零 chrome 依賴
    settings.js        設定讀取（含 agent）               ← 唯一接觸 chrome.storage
    client.js          daemon HTTP/SSE 客戶端            ← 唯一接觸 fetch
    sidebar.js         面板渲染（Shadow DOM 內）
    sidebar.css        面板樣式
    content.js         注入面板、事件串接                ← 唯一接觸頁面 DOM
    icons/             icon16.png / icon48.png / icon128.png
    package.json       僅為了 node --test
    test/prurl.test.js
  README.md
```

任務順序刻意把**純函式排在前面**：它們有最快的測試回饋迴圈，且後面的整合任務全都依賴它們的介面。`runner.js`（需要真的跑 claude）排在純函式之後、server 之前。

---

### Task 1: daemon 骨架與 token 機制

**Files:**
- Create: `prreview/daemon/package.json`
- Create: `prreview/daemon/auth.js`
- Test: `prreview/daemon/test/auth.test.js`

**Interfaces:**
- Consumes: 無（第一個任務）
- Produces:
  - `generateToken(): string` — 64 字元 hex
  - `tokenMatches(expected: string, actual: unknown): boolean` — 定時比對，型別不符回 false
  - `loadOrCreateToken(dir: string): Promise<string>` — 讀 `<dir>/token`，不存在則產生並寫入（權限 0600）

- [x] **Step 1: 建立 package.json**

`prreview/daemon/package.json`：

```json
{
  "name": "prreview-daemon",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "test": "node --test"
  }
}
```

- [x] **Step 2: 寫失敗的測試**

`prreview/daemon/test/auth.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateToken, tokenMatches, loadOrCreateToken } from '../auth.js'

test('generateToken 產生 64 字元 hex', () => {
  const token = generateToken()
  assert.equal(token.length, 64)
  assert.match(token, /^[0-9a-f]{64}$/)
})

test('generateToken 每次都不同', () => {
  assert.notEqual(generateToken(), generateToken())
})

test('tokenMatches 對相同 token 回傳 true', () => {
  const token = generateToken()
  assert.equal(tokenMatches(token, token), true)
})

test('tokenMatches 對不同 token 回傳 false', () => {
  assert.equal(tokenMatches(generateToken(), generateToken()), false)
})

test('tokenMatches 對非字串輸入回傳 false 而不是拋錯', () => {
  const token = generateToken()
  assert.equal(tokenMatches(token, undefined), false)
  assert.equal(tokenMatches(token, null), false)
  assert.equal(tokenMatches(token, 12345), false)
  assert.equal(tokenMatches(token, ['x']), false)
})

test('tokenMatches 對長度不同的字串回傳 false 而不是拋錯', () => {
  assert.equal(tokenMatches(generateToken(), 'abc'), false)
})

test('loadOrCreateToken 第一次呼叫會建立檔案', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prreview-'))
  const token = await loadOrCreateToken(dir)
  assert.match(token, /^[0-9a-f]{64}$/)
  const onDisk = await readFile(join(dir, 'token'), 'utf8')
  assert.equal(onDisk.trim(), token)
})

test('loadOrCreateToken 第二次呼叫回傳同一個 token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prreview-'))
  const first = await loadOrCreateToken(dir)
  const second = await loadOrCreateToken(dir)
  assert.equal(first, second)
})
```

- [x] **Step 3: 執行測試確認失敗**

Run: `cd prreview/daemon && node --test`
Expected: FAIL，錯誤為 `ERR_MODULE_NOT_FOUND`（`auth.js` 尚不存在）

- [x] **Step 4: 寫最小實作**

`prreview/daemon/auth.js`：

```js
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export function generateToken() {
  return randomBytes(32).toString('hex')
}

export function tokenMatches(expected, actual) {
  if (typeof actual !== 'string') return false
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(actual, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function loadOrCreateToken(dir) {
  const file = join(dir, 'token')
  try {
    const existing = await readFile(file, 'utf8')
    const trimmed = existing.trim()
    if (trimmed) return trimmed
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  const token = generateToken()
  await mkdir(dir, { recursive: true })
  await writeFile(file, token + '\n', { mode: 0o600 })
  return token
}
```

長度不同時提早回傳 `false` 會洩漏「長度是否正確」這一個 bit。這可以接受：token 長度本來就是公開的常數（永遠 64），需要保護的是內容。`timingSafeEqual` 在長度不同時會直接拋錯，所以這個提早回傳是必要的。

- [x] **Step 5: 執行測試確認通過**

Run: `cd prreview/daemon && node --test`
Expected: PASS，8 個測試全過

- [ ] **Step 6: Commit**

```bash
git add prreview/daemon/package.json prreview/daemon/auth.js prreview/daemon/test/auth.test.js
git commit -m "feat(prreview): 新增 daemon token 產生與驗證 [no-issue]"
```

---

### Task 2: stream-json 事件解析

`claude -p --output-format stream-json` 會逐行吐出 JSON。我們只需要從中萃取「面板要顯示什麼進度」，其餘一律忽略。

**關鍵設計約束：CLI 的事件格式會隨版本增減欄位，解析器遇到不認識的東西必須回傳 `null`，絕不可拋錯。** 一次 review 跑了三分鐘卻因為多了一個沒見過的事件型別而整個炸掉，是最差的失敗模式。

**Files:**
- Create: `prreview/daemon/stream.js`
- Test: `prreview/daemon/test/stream.test.js`

**Interfaces:**
- Consumes: 無
- Produces:
  - `parseStreamEvent(line: string): ProgressEvent | null`
  - `ProgressEvent` 為下列其中之一：
    - `{ kind: 'tool', tool: string, detail: string }`
    - `{ kind: 'text', text: string }`
    - `{ kind: 'result', text: string, isError: boolean }`

- [x] **Step 1: 寫失敗的測試**

`prreview/daemon/test/stream.test.js`：

```js
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
```

- [x] **Step 2: 執行測試確認失敗**

Run: `cd prreview/daemon && node --test test/stream.test.js`
Expected: FAIL，`ERR_MODULE_NOT_FOUND`

- [x] **Step 3: 寫最小實作**

`prreview/daemon/stream.js`：

```js
const MCP_PREFIX = /^mcp__[a-z0-9-]+__/i

function toolDetail(input) {
  if (!input || typeof input !== 'object') return ''
  for (const key of ['path', 'file_path', 'query', 'pattern']) {
    if (typeof input[key] === 'string') return input[key]
  }
  return ''
}

export function parseStreamEvent(line) {
  if (typeof line !== 'string' || !line.trim()) return null

  let event
  try {
    event = JSON.parse(line)
  } catch {
    return null
  }
  if (!event || typeof event !== 'object') return null

  if (event.type === 'result') {
    if (typeof event.result !== 'string') return null
    return { kind: 'result', text: event.result, isError: event.is_error === true }
  }

  if (event.type === 'assistant') {
    const content = event.message?.content
    if (!Array.isArray(content)) return null

    for (const block of content) {
      if (block?.type === 'tool_use' && typeof block.name === 'string') {
        return {
          kind: 'tool',
          tool: block.name.replace(MCP_PREFIX, ''),
          detail: toolDetail(block.input),
        }
      }
    }
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        return { kind: 'text', text: block.text }
      }
    }
    return null
  }

  return null
}
```

先掃完整個 content 找 `tool_use`，找不到才回頭找 `text`：同一則訊息同時有思考文字與工具呼叫時，「正在讀 X 檔」對使用者比一段半截的文字更有資訊量。

- [x] **Step 4: 執行測試確認通過**

Run: `cd prreview/daemon && node --test test/stream.test.js`
Expected: PASS，12 個測試全過

- [ ] **Step 5: Commit**

```bash
git add prreview/daemon/stream.js prreview/daemon/test/stream.test.js
git commit -m "feat(prreview): 新增 claude stream-json 事件解析 [no-issue]"
```

---

### Task 3: findings 驗證與正規化

**關鍵設計約束：LLM 沒照格式輸出時，整次 review 不得作廢。** 跑了三分鐘拿到有價值的分析，卻因為多包了一層 markdown code fence 就全丟掉，是不能接受的。驗證失敗時回傳原始文字，由面板降級成純文字顯示。

**Files:**
- Create: `prreview/daemon/findings.js`
- Test: `prreview/daemon/test/findings.test.js`

**Interfaces:**
- Consumes: 無
- Produces:
  - `parseFindings(text: string): ParsedFindings`
  - `ParsedFindings` 為下列其中之一：
    - `{ ok: true, summary: string, findings: Finding[] }`
    - `{ ok: false, raw: string }`
  - `Finding` = `{ file: string, line: number|null, severity: 'blocker'|'major'|'minor'|'nit', title: string, body: string }`

- [x] **Step 1: 寫失敗的測試**

`prreview/daemon/test/findings.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFindings } from '../findings.js'

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
```

- [x] **Step 2: 執行測試確認失敗**

Run: `cd prreview/daemon && node --test test/findings.test.js`
Expected: FAIL，`ERR_MODULE_NOT_FOUND`

- [x] **Step 3: 寫最小實作**

`prreview/daemon/findings.js`：

```js
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
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim())
  return null
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
```

未知的 severity 正規化為 `minor` 而不是丟棄整則：意見內容本身仍有價值，錯的只是分類。

- [x] **Step 4: 執行測試確認通過**

Run: `cd prreview/daemon && node --test test/findings.test.js`
Expected: PASS，14 個測試全過

- [ ] **Step 5: Commit**

```bash
git add prreview/daemon/findings.js prreview/daemon/test/findings.test.js
git commit -m "feat(prreview): 新增 findings 驗證與降級處理 [no-issue]"
```

---

### Task 4: PR 網址解析

**Files:**
- Create: `prreview/extension/package.json`
- Create: `prreview/extension/prurl.js`
- Test: `prreview/extension/test/prurl.test.js`

**Interfaces:**
- Consumes: 無
- Produces:
  - `parsePrUrl(url: string): { org: string, project: string, repo: string, prId: number } | null`

- [x] **Step 1: 建立 package.json**

`prreview/extension/package.json`：

```json
{
  "name": "prreview-extension",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [x] **Step 2: 寫失敗的測試**

`prreview/extension/test/prurl.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePrUrl } from '../prurl.js'

test('解析標準 PR 網址', () => {
  const url = 'https://dev.azure.com/contoso/Payments/_git/payments-api/pullrequest/1234'
  assert.deepEqual(parsePrUrl(url), {
    org: 'contoso',
    project: 'Payments',
    repo: 'payments-api',
    prId: 1234,
  })
})

test('忽略 query string 與 hash', () => {
  const url =
    'https://dev.azure.com/contoso/Payments/_git/payments-api/pullrequest/1234?_a=files#path=/src/a.cs'
  assert.equal(parsePrUrl(url).prId, 1234)
})

test('結尾多一個斜線仍可解析', () => {
  const url = 'https://dev.azure.com/contoso/Payments/_git/payments-api/pullrequest/1234/'
  assert.equal(parsePrUrl(url).prId, 1234)
})

test('專案名稱含空白（URL 編碼）會被還原', () => {
  const url = 'https://dev.azure.com/contoso/My%20Project/_git/my-repo/pullrequest/7'
  assert.equal(parsePrUrl(url).project, 'My Project')
})

test('repo 名稱含點號可解析', () => {
  const url = 'https://dev.azure.com/contoso/Proj/_git/Company.Api.Core/pullrequest/9'
  assert.equal(parsePrUrl(url).repo, 'Company.Api.Core')
})

test('PR 列表頁回傳 null', () => {
  assert.equal(
    parsePrUrl('https://dev.azure.com/contoso/Payments/_git/payments-api/pullrequests'),
    null
  )
})

test('repo 首頁回傳 null', () => {
  assert.equal(parsePrUrl('https://dev.azure.com/contoso/Payments/_git/payments-api'), null)
})

test('非 dev.azure.com 網域回傳 null', () => {
  assert.equal(parsePrUrl('https://contoso.visualstudio.com/Proj/_git/repo/pullrequest/1'), null)
  assert.equal(parsePrUrl('https://github.com/a/b/pull/1'), null)
})

test('http 協定回傳 null', () => {
  assert.equal(parsePrUrl('http://dev.azure.com/contoso/P/_git/r/pullrequest/1'), null)
})

test('PR 編號非數字回傳 null', () => {
  assert.equal(parsePrUrl('https://dev.azure.com/contoso/P/_git/r/pullrequest/abc'), null)
})

test('無效輸入回傳 null 而不是拋錯', () => {
  assert.equal(parsePrUrl(''), null)
  assert.equal(parsePrUrl('不是網址'), null)
  assert.equal(parsePrUrl(undefined), null)
  assert.equal(parsePrUrl(null), null)
})
```

- [x] **Step 3: 執行測試確認失敗**

Run: `cd prreview/extension && node --test`
Expected: FAIL，`ERR_MODULE_NOT_FOUND`

- [x] **Step 4: 寫最小實作**

`prreview/extension/prurl.js`：

```js
const PR_PATH = /^\/([^/]+)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)\/?$/

export function parsePrUrl(url) {
  if (typeof url !== 'string' || !url) return null

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'dev.azure.com') return null

  const match = parsed.pathname.match(PR_PATH)
  if (!match) return null

  const [, org, project, repo, prId] = match
  return {
    org: decodeURIComponent(org),
    project: decodeURIComponent(project),
    repo: decodeURIComponent(repo),
    prId: Number(prId),
  }
}
```

- [x] **Step 5: 執行測試確認通過**

Run: `cd prreview/extension && node --test`
Expected: PASS，11 個測試全過

- [ ] **Step 6: Commit**

```bash
git add prreview/extension/package.json prreview/extension/prurl.js prreview/extension/test/prurl.test.js
git commit -m "feat(prreview): 新增 Azure DevOps PR 網址解析 [no-issue]"
```

---

### Task 5: 共用審核 prompt 與 Claude 執行器

這是第一個會真的花錢、真的花時間的任務。它沒有自動化測試——`runner.js` 的行為取決於一個外部 process 與一個 LLM，寫 mock 只會測到 mock。**驗收方式是手動跑一次真正的 PR。**

**Files:**
- Create: `prreview/daemon/prompts/review.md`
- Create: `prreview/daemon/runner.js`

**Interfaces:**
- Consumes: `parseStreamEvent` (Task 2)、`parseFindings` (Task 3)
- Produces:
  - `runReview(pr, options?): { events: AsyncIterable<Event>, cancel(): void }`
    - `pr` = `{ org, project, repo, prId }`
    - `options` = `{ claudePath?: string, model?: string }`
    - 產出 Task 2 的 `tool` / `text` 事件，外加結尾的 `{ kind: 'done', result: ParsedFindings }` 或 `{ kind: 'error', message: string }`
  - `checkClaudeAvailable(claudePath: string): Promise<boolean>`

- [x] **Step 1: 寫審核 prompt**

`prreview/daemon/prompts/review.md`（注意：檔案內含一段以三個反引號包住的 JSON 範例，照抄即可）：

```markdown
你要審核一個 Azure DevOps 的 Pull Request。

PR 座標：
- organization: {{org}}
- project: {{project}}
- repository: {{repo}}
- pull request id: {{prId}}

## 步驟

1. 用 `azure-devops` MCP 取得這個 PR 的描述與完整 diff。
2. 嘗試讀取 repo 根目錄與變更路徑適用的 `AGENTS.md`、`CLAUDE.md`。若存在，把裡面的規範當作審核依據的一部分，優先於你的通用習慣。
3. 對於 diff 中不足以判斷的部分，主動用 MCP 讀取相關檔案（呼叫端、被修改函式的其他用途、同類 pattern 在專案其他地方的寫法）。不要只看 diff 就下結論。
4. 產出審核意見。

## 要回報什麼

- 會導致錯誤行為的缺陷：null／邊界／並行／例外吞噬／資源未釋放
- 安全問題：注入、權限缺漏、機密外洩、越權存取
- 與專案既有慣例明顯不一致的寫法
- 缺少測試覆蓋的關鍵邏輯

## 不要回報什麼

- 純風格偏好（排版、引號、命名喜好），除非 repo 規範明文要求
- 「可以考慮加上註解」這類沒有具體缺陷的建議
- 你沒有實際讀過的檔案裡的臆測
- 重複同一個問題：同類問題只報一次，在 body 裡說明還有哪些地方也有

寧可少報也不要誤報。一則假警報對使用者的成本，高過漏掉一則次要問題。

## 輸出格式

最後一則訊息只輸出一個 JSON 物件，不要包在 code fence 裡，不要加任何前後說明。結構如下：

- summary：字串，一到三句話的整體評價
- findings：陣列，每個元素包含
  - file：字串，相對於 repo 根目錄的路徑
  - line：數字，問題所在行號
  - severity：字串，四選一，見下方判準
  - title：字串，十五字以內的問題標題
  - body：字串，說明問題、為什麼是問題、建議怎麼改

沒有發現問題時，findings 給空陣列，summary 說明你檢查了什麼。

severity 判準：
- blocker：會造成資料錯誤、安全漏洞或服務中斷，不修不能合併
- major：明確的缺陷，但影響範圍有限
- minor：值得改，但不修也不會出事
- nit：吹毛求疵，作者可自行判斷
```

- [x] **Step 2: 寫執行器**

`prreview/daemon/runner.js`：

```js
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStreamEvent } from './stream.js'
import { parseFindings } from './findings.js'

const HERE = dirname(fileURLToPath(import.meta.url))

const READ_ONLY_TOOLS = [
  'mcp__azure-devops__repo_pull_request',
  'mcp__azure-devops__repo_file',
  'mcp__azure-devops__repo_branch',
  'mcp__azure-devops__repo_repository',
  'mcp__azure-devops__search_code',
]

async function buildPrompt(pr) {
  const template = await readFile(join(HERE, 'prompts', 'review.md'), 'utf8')
  return template
    .replaceAll('{{org}}', pr.org)
    .replaceAll('{{project}}', pr.project)
    .replaceAll('{{repo}}', pr.repo)
    .replaceAll('{{prId}}', String(pr.prId))
}

export function checkClaudeAvailable(claudePath) {
  return new Promise((resolve) => {
    const child = spawn(claudePath, ['--version'], { stdio: 'ignore', shell: false })
    child.on('error', () => resolve(false))
    child.on('exit', (code) => resolve(code === 0))
  })
}

export function runReview(pr, options = {}) {
  const claudePath = options.claudePath || 'claude'
  let child = null
  let cancelled = false
  let spawnError = null

  async function* generate() {
    const prompt = await buildPrompt(pr)
    const args = [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--restricted',
      '--allowedTools',
      ...READ_ONLY_TOOLS,
      '--permission-mode',
      'dontAsk',
    ]
    if (options.model) args.push('--model', options.model)

    child = spawn(claudePath, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false })

    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => {
      spawnError = err
    })

    const exited = new Promise((resolve) => child.on('close', (code) => resolve(code)))

    let finalText = null
    let sawError = false
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    for await (const line of lines) {
      const event = parseStreamEvent(line)
      if (!event) continue
      if (event.kind === 'result') {
        if (event.isError) {
          sawError = true
          yield { kind: 'error', message: event.text }
        } else {
          finalText = event.text
        }
        continue
      }
      yield event
    }

    const code = await exited

    if (spawnError) {
      const message =
        spawnError.code === 'ENOENT'
          ? `找不到 claude 執行檔：${claudePath}`
          : `無法啟動 claude：${spawnError.message}`
      yield { kind: 'error', message }
      return
    }
    if (cancelled) {
      yield { kind: 'error', message: '已取消' }
      return
    }
    if (sawError) return
    if (finalText === null) {
      yield { kind: 'error', message: stderr.trim() || `claude 以代碼 ${code} 結束但沒有產生結果` }
      return
    }
    yield { kind: 'done', result: parseFindings(finalText) }
  }

  return {
    events: generate(),
    cancel() {
      cancelled = true
      if (child) child.kill()
    },
  }
}
```

`--verbose` 是必要的：`--output-format stream-json` 搭配 `-p` 時需要它才會輸出完整事件串流。`--restricted` 把 Bash／PowerShell／REPL 整組移除，`--allowedTools` 再收斂到五個唯讀的 MCP 工具——這兩層一起保證 review 階段的 agent 不具備任何寫入能力。

- [x] **Step 3: 驗證 claude 不存在時的錯誤處理**

Run:

```bash
cd prreview/daemon && node -e "const m=await import('./runner.js'); const {events}=m.runReview({org:'a',project:'b',repo:'c',prId:1},{claudePath:'claude-does-not-exist'}); for await (const e of events) console.log(e)" --input-type=module
```

若上面的寫法在你的 Node 版本不便使用，改建立暫用檔 `prreview/daemon/scratch-missing.js`：

```js
import { runReview } from './runner.js'

const { events } = runReview(
  { org: 'a', project: 'b', repo: 'c', prId: 1 },
  { claudePath: 'claude-does-not-exist' }
)
for await (const event of events) console.log(event)
```

Run: `cd prreview/daemon && node scratch-missing.js`
Expected: 印出 `{ kind: 'error', message: '找不到 claude 執行檔：claude-does-not-exist' }`，process 正常結束，沒有未捕捉的例外

- [ ] **Step 4: 手動驗收真實 PR**

建立 `prreview/daemon/scratch-run.js`（**驗收後刪除，不 commit**）：

```js
import { runReview } from './runner.js'

const pr = {
  org: process.argv[2],
  project: process.argv[3],
  repo: process.argv[4],
  prId: Number(process.argv[5]),
}
const { events } = runReview(pr)
for await (const event of events) {
  console.log(JSON.stringify(event))
}
```

Run（換成真實的 PR 座標）：

```bash
cd prreview/daemon && node scratch-run.js <org> <project> <repo> <prId>
```

Expected:
1. 陸續印出 `{"kind":"tool","tool":"repo_pull_request",...}` 等進度事件
2. 最後印出 `{"kind":"done","result":{"ok":true,...}}`
3. `result.ok` 為 `true`，且 findings 內容確實與該 PR 相關

**這一步就是 M1 存在的理由。** 若 findings 品質明顯不堪用（假警報遍地、意見空泛），**停下來回報，不要繼續往下做 UI**——那代表要回頭調整 prompt，或重新檢視「不給本機 clone」這個決策。

- [ ] **Step 5: 刪除暫用腳本並 commit**

```bash
rm -f prreview/daemon/scratch-run.js prreview/daemon/scratch-missing.js
git add prreview/daemon/runner.js prreview/daemon/prompts/review.md
git commit -m "feat(prreview): 新增審核 prompt 與 claude 執行器 [no-issue]"
```

---

### Task 5A: Codex provider、MCP 隔離與 Agent 選擇

Codex 的非互動模式使用 `codex exec`。`--json` 會在 stdout 產生 JSONL 事件，`--ephemeral` 避免留下 session rollout，`--sandbox read-only` 限制本機檔案寫入。Codex sandbox 不等於 MCP 工具白名單，因此還要隔離使用者設定，只重新注入 `azure-devops` 的唯讀工具。

官方依據：OpenAI Codex 的 [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) 與 [MCP 設定](https://learn.chatgpt.com/docs/extend/mcp)。實作時仍以專案安裝的 `codex exec --help` 與去識別化 JSONL fixture 為準。

**Files:**
- Create: `prreview/daemon/codex.js`
- Create: `prreview/daemon/prompts/findings.schema.json`
- Create: `prreview/daemon/test/codex.test.js`
- Modify: `prreview/daemon/runner.js`

**Interfaces:**
- Consumes: 共用 `review.md` prompt、`parseFindings` (Task 3)
- Produces:
  - `loadCodexAzureMcp(codexPath): Promise<McpConfig>`：執行 `codex mcp get azure-devops --json`，只取需要的 transport 欄位
  - `buildCodexInvocation(prompt, mcp, options): { args: string[], env: object }`
  - `parseCodexStreamEvent(line): ProgressEvent | null`
  - `runCodexReview(pr, options): { events: AsyncIterable<Event>, cancel(): void }`
  - `runReview(pr, options)`：依 `options.agent` dispatch 到 Claude 或 Codex
  - `checkAgentAvailable(agent, executable): Promise<boolean>`

- [x] **Step 1: 建立 findings JSON Schema**

`prreview/daemon/prompts/findings.schema.json`：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["summary", "findings"],
  "properties": {
    "summary": { "type": "string" },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["file", "line", "severity", "title", "body"],
        "properties": {
          "file": { "type": "string", "minLength": 1 },
          "line": {
            "anyOf": [
              { "type": "integer", "minimum": 1 },
              { "type": "null" }
            ]
          },
          "severity": { "enum": ["blocker", "major", "minor", "nit"] },
          "title": { "type": "string" },
          "body": { "type": "string" }
        }
      }
    }
  }
}
```

Codex 使用 `--output-schema` 強化輸出穩定性；最後仍交給 `parseFindings`，保留原始文字降級能力。Claude 不依賴這個 flag，繼續由 prompt 約束格式。

- [x] **Step 2: 寫 Codex adapter 測試**

至少覆蓋：

1. 空行、壞 JSON、未知事件回傳 `null`，不得拋錯。
2. `item.started`／`item.completed` 的 MCP tool call 轉為 `{ kind: 'tool' }`。
3. `item.completed` 的 `agent_message` 轉為 `{ kind: 'result', text, isError: false }`。
4. `turn.failed` 與 `error` 轉為 `{ kind: 'result', text, isError: true }`。
5. `buildCodexInvocation` 必含：
   - `exec`
   - `--json`
   - `--ephemeral`
   - `--sandbox read-only`
   - `--skip-git-repo-check`
   - `--ignore-user-config`
   - `--output-schema <findings.schema.json>`
6. isolated config 只建立 `mcp_servers.azure-devops`，設 `required=true`，且 `enabled_tools` 僅包含：
   - `repo_pull_request`
   - `repo_file`
   - `repo_branch`
   - `repo_repository`
   - `search_code`
7. 從 `codex mcp get` 讀到的 literal `transport.env` 不得直接放入 argv 或 log；改放入 child process environment，config 只以 `env_vars` 引用原變數名稱。
8. 未設定 `azure-devops` MCP 時，回傳可行動錯誤，不得退回使用完整使用者 config。
9. `agent` 未提供時走 `claude`；指定 `codex` 時走 Codex；其他值在建立 process 前失敗。

測試 fixture 先使用官方文件中穩定的 `thread.*`／`turn.*`／`item.*` 事件形狀。M1 手動驗收時，再從實際安裝版本擷取一份去識別化 JSONL fixture，補上 MCP tool call 的真實欄位形狀；parser 對未知欄位仍須寬鬆。

- [x] **Step 3: 實作隔離的 Codex invocation**

流程固定如下：

1. 用使用者原本的設定執行 `codex mcp get azure-devops --json`，取得該 server 的 command、args、cwd、env 與 timeout；不得把結果印到 log。
2. 建立 `codex exec` argv，加入 `--ignore-user-config`。
3. 用 `-c` 只重建 `mcp_servers.azure-devops`，並覆寫 `enabled_tools` 為唯讀白名單、`required=true`。
4. 將 literal MCP env 值放進 child process environment，argv 只帶 env 變數名稱，避免祕密出現在 process list。
5. 禁止使用 `--dangerously-bypass-approvals-and-sandbox`、`danger-full-access` 或 `workspace-write`。
6. 以 `--output-schema` 指向 `findings.schema.json`，prompt 作為最後一個 argument。

預期命令語意：

```text
codex exec
  --json
  --ephemeral
  --sandbox read-only
  --skip-git-repo-check
  --ignore-user-config
  -c <只含 azure-devops 的隔離設定>
  --output-schema <findings.schema.json>
  [--model <model>]
  <prompt>
```

- [x] **Step 4: 修改 runner 成為 provider facade**

`runReview` 介面改為：

```js
runReview(pr, {
  agent: 'claude' | 'codex',
  claudePath?: string,
  codexPath?: string,
  model?: string,
})
```

- `agent` 預設 `claude`，維持既有行為。
- Claude 路徑沿用 Task 5 的 runner。
- Codex 路徑委派給 `runCodexReview`。
- 兩個 adapter 都輸出相同的 `tool`／`text`／`done`／`error` 事件，`jobs.js` 與瀏覽器端不需要知道 provider 差異。
- `checkAgentAvailable` 依 agent 執行 `<cli> --version`；daemon 啟動時可列出可用狀態，但不能因另一個未安裝就退出。

- [x] **Step 5: 手動驗收 Codex**

先確認：

```text
codex --version
codex mcp get azure-devops --json
```

再用 `scratch-run.js` 加入第一個參數 `agent`，分別跑同一個真實 PR：

```text
node scratch-run.js claude <org> <project> <repo> <prId>
node scratch-run.js codex  <org> <project> <repo> <prId>
```

Expected：兩者都會輸出共同格式的進度事件，最後為 `done`；Codex JSONL 中不得出現非白名單 MCP 或 file change 事件。若出現 command execution，必須確認它受 read-only sandbox 限制且沒有寫入；若出現前述禁用事件，視為隔離失敗並停止後續 UI 工作。

已以 `runReview({ agent: 'codex' })` 實際執行 PR 67066：完成 `repo_pull_request`、`repo_file`、`search_code` 唯讀呼叫，共 51 個 MCP 事件，沒有非白名單工具或 file change，最後 `done` 且 findings 為空。

- [ ] **Step 6: Commit**

```bash
git add prreview/daemon/codex.js prreview/daemon/runner.js prreview/daemon/prompts/findings.schema.json prreview/daemon/test/codex.test.js
git commit -m "feat(prreview): 新增 Codex 審核 provider 與隔離設定 [no-issue]"
```

---

### Task 6: job 生命週期管理

一個 job 可能被多個訂閱者掛載（同一個 PR 開了兩個分頁），且訂閱者可能中途離開再回來。因此 job 必須保留完整事件歷史，讓後來掛上的訂閱者能補看到之前的進度。

**Files:**
- Create: `prreview/daemon/jobs.js`
- Test: `prreview/daemon/test/jobs.test.js`

**Interfaces:**
- Consumes: 無（`runReview` 由呼叫端以 `runFn` 注入，方便測試）
- Produces:
  - `createJobStore(): { start(key, runFn): Job, find(key): Job | null }`
  - `Job` = `{ id: string, key: string, status: 'running'|'done'|'error', history: Event[], subscribe(fn): () => void, cancel(): void }`
  - `subscribe(fn)` 會**立即同步**把 `history` 中既有事件逐一送給 `fn`，之後才推送新事件；回傳取消訂閱函式

- [x] **Step 1: 寫失敗的測試**

`prreview/daemon/test/jobs.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createJobStore } from '../jobs.js'

function fakeRun(events) {
  return () => ({
    events: (async function* () {
      for (const event of events) yield event
    })(),
    cancel() {},
  })
}

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

test('start 回傳的 job 一開始是 running', () => {
  const store = createJobStore()
  const job = store.start('pr-1', fakeRun([]))
  assert.equal(job.status, 'running')
  assert.match(job.id, /.+/)
})

test('job 跑完後 status 變 done 且事件進入 history', async () => {
  const store = createJobStore()
  const job = store.start(
    'pr-1',
    fakeRun([
      { kind: 'tool', tool: 'repo_file', detail: 'a.cs' },
      { kind: 'done', result: { ok: true, summary: 's', findings: [] } },
    ])
  )
  await settle()
  assert.equal(job.status, 'done')
  assert.equal(job.history.length, 2)
})

test('收到 error 事件後 status 變 error', async () => {
  const store = createJobStore()
  const job = store.start('pr-1', fakeRun([{ kind: 'error', message: '壞了' }]))
  await settle()
  assert.equal(job.status, 'error')
})

test('沒有產生任何結尾事件時補一個 error', async () => {
  const store = createJobStore()
  const job = store.start('pr-1', fakeRun([{ kind: 'text', text: '只有這個' }]))
  await settle()
  assert.equal(job.status, 'error')
  assert.equal(job.history.at(-1).kind, 'error')
})

test('執行中拋錯會轉成 error 事件而不是未捕捉例外', async () => {
  const store = createJobStore()
  const job = store.start('pr-1', () => ({
    events: (async function* () {
      throw new Error('爆了')
    })(),
    cancel() {},
  }))
  await settle()
  assert.equal(job.status, 'error')
  assert.match(job.history.at(-1).message, /爆了/)
})

test('訂閱者會收到後續事件', async () => {
  const store = createJobStore()
  const job = store.start('pr-1', fakeRun([{ kind: 'text', text: 'hi' }]))
  const seen = []
  job.subscribe((event) => seen.push(event))
  await settle()
  assert.equal(seen[0].text, 'hi')
})

test('晚到的訂閱者會補收到歷史事件', async () => {
  const store = createJobStore()
  const job = store.start(
    'pr-1',
    fakeRun([
      { kind: 'text', text: '第一則' },
      { kind: 'done', result: { ok: true, summary: '', findings: [] } },
    ])
  )
  await settle()
  const seen = []
  job.subscribe((event) => seen.push(event))
  assert.equal(seen.length, 2)
  assert.equal(seen[0].text, '第一則')
})

test('取消訂閱後不再收到事件', async () => {
  const store = createJobStore()
  let release
  const job = store.start('pr-1', () => ({
    events: (async function* () {
      yield { kind: 'text', text: '第一則' }
      await new Promise((resolve) => {
        release = resolve
      })
      yield { kind: 'text', text: '第二則' }
    })(),
    cancel() {},
  }))
  const seen = []
  const unsubscribe = job.subscribe((event) => seen.push(event))
  await settle()
  unsubscribe()
  release()
  await settle()
  assert.equal(seen.length, 1)
})

test('find 以 key 取回既有 job', () => {
  const store = createJobStore()
  const job = store.start('pr-1', fakeRun([]))
  assert.equal(store.find('pr-1'), job)
  assert.equal(store.find('pr-2'), null)
})

test('同一個 key 再次 start 會取代舊 job', () => {
  const store = createJobStore()
  const first = store.start('pr-1', fakeRun([]))
  const second = store.start('pr-1', fakeRun([]))
  assert.notEqual(first.id, second.id)
  assert.equal(store.find('pr-1'), second)
})

test('訂閱者拋錯不會拖垮其他訂閱者', async () => {
  const store = createJobStore()
  const job = store.start('pr-1', fakeRun([{ kind: 'text', text: 'hi' }]))
  job.subscribe(() => {
    throw new Error('訂閱者爆了')
  })
  const seen = []
  job.subscribe((event) => seen.push(event))
  await settle()
  assert.equal(seen.length, 1)
})
```

- [x] **Step 2: 執行測試確認失敗**

Run: `cd prreview/daemon && node --test test/jobs.test.js`
Expected: FAIL，`ERR_MODULE_NOT_FOUND`

- [x] **Step 3: 寫最小實作**

`prreview/daemon/jobs.js`：

```js
import { randomUUID } from 'node:crypto'

export function createJobStore() {
  const byKey = new Map()

  function start(key, runFn) {
    const subscribers = new Set()

    const job = {
      id: randomUUID(),
      key,
      status: 'running',
      history: [],
      subscribe(fn) {
        for (const event of job.history) {
          try {
            fn(event)
          } catch {
            // 訂閱者自己的問題，不影響 job
          }
        }
        subscribers.add(fn)
        return () => subscribers.delete(fn)
      },
      cancel() {},
    }

    const handle = runFn()
    job.cancel = () => handle.cancel()

    function emit(event) {
      job.history.push(event)
      if (event.kind === 'done') job.status = 'done'
      if (event.kind === 'error') job.status = 'error'
      for (const fn of [...subscribers]) {
        try {
          fn(event)
        } catch {
          // 同上
        }
      }
    }

    void (async () => {
      try {
        for await (const event of handle.events) emit(event)
      } catch (err) {
        emit({ kind: 'error', message: err?.message || String(err) })
        return
      }
      if (job.status === 'running') {
        emit({ kind: 'error', message: '執行結束但沒有產生結果' })
      }
    })()

    byKey.set(key, job)
    return job
  }

  return {
    start,
    find: (key) => byKey.get(key) || null,
  }
}
```

`emit` 迭代 `[...subscribers]` 的複本：訂閱者在收到事件的當下可能呼叫 `unsubscribe`（SSE 收到 `done` 就會這麼做），直接迭代原 Set 會在迭代中改動集合。

- [x] **Step 4: 執行測試確認通過**

Run: `cd prreview/daemon && node --test test/jobs.test.js`
Expected: PASS，11 個測試全過

- [ ] **Step 5: Commit**

```bash
git add prreview/daemon/jobs.js prreview/daemon/test/jobs.test.js
git commit -m "feat(prreview): 新增 job 生命週期與訂閱管理 [no-issue]"
```

---

### Task 7: HTTP server（token 驗證、CORS、SSE）

**Files:**
- Create: `prreview/daemon/server.js`
- Test: `prreview/daemon/test/server.test.js`

**Interfaces:**
- Consumes: `tokenMatches` / `loadOrCreateToken` (Task 1)、`createJobStore` (Task 6)、`runReview` / `checkAgentAvailable` (Task 5A)
- Produces:
  - `createServer({ token, jobStore?, runFn? }): http.Server`
  - `main(): Promise<void>` — 讀環境變數、檢查 claude、載入 token、啟動監聽
  - 路由：
    - `GET /health` → `200 { ok: true }`（**不需 token**，用來判斷 daemon 是否啟動）
    - `POST /review` body `{ org, project, repo, prId, agent }` → `201 { jobId }`
    - `GET /jobs/:id/events` → SSE
    - 其餘 → 404

- [x] **Step 1: 寫失敗的測試**

`prreview/daemon/test/server.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from '../server.js'
import { createJobStore } from '../jobs.js'

const TOKEN = 'a'.repeat(64)
const ORIGIN = 'https://dev.azure.com'
const PR = { org: 'contoso', project: 'P', repo: 'r', prId: 1, agent: 'claude' }

function fakeRunFn(events = []) {
  return () => ({
    events: (async function* () {
      for (const event of events) yield event
    })(),
    cancel() {},
  })
}

async function withServer(runFn, fn) {
  const server = createServer({ token: TOKEN, jobStore: createJobStore(), runFn })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await fn(base)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

function post(base, body, token = TOKEN) {
  const headers = { 'Content-Type': 'application/json' }
  if (token !== null) headers['X-PRReview-Token'] = token
  return fetch(`${base}/review`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

test('/health 不需要 token', async () => {
  await withServer(fakeRunFn(), async (base) => {
    const res = await fetch(`${base}/health`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true })
  })
})

test('沒帶 token 的 /review 回 401', async () => {
  await withServer(fakeRunFn(), async (base) => {
    assert.equal((await post(base, PR, null)).status, 401)
  })
})

test('token 錯誤的 /review 回 401', async () => {
  await withServer(fakeRunFn(), async (base) => {
    assert.equal((await post(base, PR, 'b'.repeat(64))).status, 401)
  })
})

test('token 錯誤時不會啟動任何 job', async () => {
  let started = false
  const runFn = () => {
    started = true
    return fakeRunFn()()
  }
  await withServer(runFn, async (base) => {
    await post(base, PR, null)
    assert.equal(started, false)
  })
})

test('token 正確的 /review 回 201 與 jobId', async () => {
  await withServer(fakeRunFn(), async (base) => {
    const res = await post(base, PR)
    assert.equal(res.status, 201)
    assert.match((await res.json()).jobId, /.+/)
  })
})

test('agent 可選 claude 或 codex', async () => {
  const seen = []
  const runFn = (pr, options) => {
    seen.push(options.agent)
    return fakeRunFn([{ kind: 'done', result: { ok: true, summary: '', findings: [] } }])()
  }
  await withServer(runFn, async (base) => {
    assert.equal((await post(base, { ...PR, agent: 'claude' })).status, 201)
    assert.equal((await post(base, { ...PR, agent: 'codex' })).status, 201)
  })
  assert.deepEqual(seen, ['claude', 'codex'])
})

test('未提供 agent 時預設使用 claude', async () => {
  let seen
  const runFn = (pr, options) => {
    seen = options.agent
    return fakeRunFn([{ kind: 'done', result: { ok: true, summary: '', findings: [] } }])()
  }
  await withServer(runFn, async (base) => {
    const { agent, ...withoutAgent } = PR
    assert.equal((await post(base, withoutAgent)).status, 201)
  })
  assert.equal(seen, 'claude')
})

test('未知 agent 回 400 且不啟動 job', async () => {
  let started = false
  const runFn = () => {
    started = true
    return fakeRunFn()()
  }
  await withServer(runFn, async (base) => {
    assert.equal((await post(base, { ...PR, agent: 'other' })).status, 400)
  })
  assert.equal(started, false)
})

test('缺欄位的 /review 回 400', async () => {
  await withServer(fakeRunFn(), async (base) => {
    assert.equal((await post(base, { org: 'contoso' })).status, 400)
  })
})

test('prId 非正整數的 /review 回 400', async () => {
  await withServer(fakeRunFn(), async (base) => {
    assert.equal((await post(base, { ...PR, prId: 0 })).status, 400)
    assert.equal((await post(base, { ...PR, prId: '1' })).status, 400)
  })
})

test('壞掉的 JSON body 回 400 而不是讓 server 掛掉', async () => {
  await withServer(fakeRunFn(), async (base) => {
    assert.equal((await post(base, '{ 壞掉的')).status, 400)
    assert.equal((await fetch(`${base}/health`)).status, 200)
  })
})

test('OPTIONS 預檢回 204 並帶 CORS 標頭', async () => {
  await withServer(fakeRunFn(), async (base) => {
    const res = await fetch(`${base}/review`, {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' },
    })
    assert.equal(res.status, 204)
    assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN)
    assert.match(res.headers.get('access-control-allow-headers'), /X-PRReview-Token/i)
  })
})

test('非白名單 origin 不會拿到 CORS 放行標頭', async () => {
  await withServer(fakeRunFn(), async (base) => {
    const res = await fetch(`${base}/health`, { headers: { Origin: 'https://evil.example' } })
    assert.equal(res.headers.get('access-control-allow-origin'), null)
  })
})

test('SSE 推送事件並在結束時關閉', async () => {
  const runFn = fakeRunFn([
    { kind: 'tool', tool: 'repo_pull_request', detail: '' },
    { kind: 'done', result: { ok: true, summary: '沒問題', findings: [] } },
  ])
  await withServer(runFn, async (base) => {
    const { jobId } = await (await post(base, PR)).json()

    const res = await fetch(`${base}/jobs/${jobId}/events`, {
      headers: { 'X-PRReview-Token': TOKEN },
    })
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /text\/event-stream/)

    let text = ''
    const decoder = new TextDecoder()
    for await (const chunk of res.body) text += decoder.decode(chunk, { stream: true })

    assert.match(text, /"kind":"tool"/)
    assert.match(text, /"kind":"done"/)
  })
})

test('不存在的 jobId 回 404', async () => {
  await withServer(fakeRunFn(), async (base) => {
    const res = await fetch(`${base}/jobs/does-not-exist/events`, {
      headers: { 'X-PRReview-Token': TOKEN },
    })
    assert.equal(res.status, 404)
  })
})

test('SSE 也需要 token', async () => {
  await withServer(fakeRunFn(), async (base) => {
    assert.equal((await fetch(`${base}/jobs/whatever/events`)).status, 401)
  })
})

test('未知路徑回 404', async () => {
  await withServer(fakeRunFn(), async (base) => {
    const res = await fetch(`${base}/nope`, { headers: { 'X-PRReview-Token': TOKEN } })
    assert.equal(res.status, 404)
  })
})
```

- [x] **Step 2: 執行測試確認失敗**

Run: `cd prreview/daemon && node --test test/server.test.js`
Expected: FAIL，`ERR_MODULE_NOT_FOUND`

- [x] **Step 3: 寫最小實作**

`prreview/daemon/server.js`：

```js
import { createServer as createHttpServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { tokenMatches, loadOrCreateToken } from './auth.js'
import { createJobStore } from './jobs.js'
import { runReview, checkAgentAvailable } from './runner.js'

const ALLOWED_ORIGINS = new Set(['https://dev.azure.com'])
const JOB_EVENTS = /^\/jobs\/([^/]+)\/events$/
const MAX_BODY = 1_000_000

function applyCors(req, res) {
  const origin = req.headers.origin
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-PRReview-Token')
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > MAX_BODY) {
        reject(new Error('body 過大'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('body 不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function validReviewRequest(body) {
  if (!body || typeof body !== 'object') return null
  const { org, project, repo, prId, agent = 'claude' } = body
  if (typeof org !== 'string' || !org) return null
  if (typeof project !== 'string' || !project) return null
  if (typeof repo !== 'string' || !repo) return null
  if (!Number.isInteger(prId) || prId <= 0) return null
  if (agent !== 'claude' && agent !== 'codex') return null
  return { pr: { org, project, repo, prId }, agent }
}

export function createServer({
  token,
  jobStore = createJobStore(),
  runFn = (pr, options) => runReview(pr, options),
}) {
  const byId = new Map()

  return createHttpServer(async (req, res) => {
    applyCors(req, res)

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url, 'http://127.0.0.1')

    if (url.pathname === '/health') {
      json(res, 200, { ok: true })
      return
    }

    // token 驗證必須在任何副作用之前
    if (!tokenMatches(token, req.headers['x-prreview-token'])) {
      json(res, 401, { error: 'token 無效或未提供' })
      return
    }

    if (req.method === 'POST' && url.pathname === '/review') {
      let body
      try {
        body = await readBody(req)
      } catch (err) {
        json(res, 400, { error: err.message })
        return
      }
      const request = validReviewRequest(body)
      if (!request) {
        json(res, 400, {
          error: '需要 org / project / repo / prId，agent 只能是 claude 或 codex',
        })
        return
      }
      const { pr, agent } = request
      const key = `${agent}:${pr.org}/${pr.project}/${pr.repo}/${pr.prId}`
      const job = jobStore.start(key, () => runFn(pr, { agent }))
      byId.set(job.id, job)
      json(res, 201, { jobId: job.id })
      return
    }

    const match = url.pathname.match(JOB_EVENTS)
    if (req.method === 'GET' && match) {
      const job = byId.get(decodeURIComponent(match[1]))
      if (!job) {
        json(res, 404, { error: '找不到這個 job' })
        return
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })

      // subscribe 會同步重播歷史事件，若 job 已結束，回呼會在 subscribe
      // 回傳之前就觸發。因此 unsubscribe 必須先宣告再指派，否則會踩到
      // const 的暫時性死區。
      let unsubscribe = () => {}
      let closed = false
      const finish = () => {
        if (closed) return
        closed = true
        unsubscribe()
        res.end()
      }

      unsubscribe = job.subscribe((event) => {
        if (closed) return
        res.write(`data: ${JSON.stringify(event)}\n\n`)
        if (event.kind === 'done' || event.kind === 'error') finish()
      })

      req.on('close', finish)
      return
    }

    json(res, 404, { error: '找不到這個路徑' })
  })
}

export async function main() {
  const port = Number(process.env.PRREVIEW_PORT || 7797)
  const claudePath = process.env.PRREVIEW_CLAUDE || 'claude'
  const codexPath = process.env.PRREVIEW_CODEX || 'codex'
  const configDir = join(homedir(), '.prreview')

  const [claudeAvailable, codexAvailable] = await Promise.all([
    checkAgentAvailable('claude', claudePath),
    checkAgentAvailable('codex', codexPath),
  ])

  const token = await loadOrCreateToken(configDir)
  const server = createServer({
    token,
    runFn: (pr, { agent }) => runReview(pr, { agent, claudePath, codexPath }),
  })
  server.listen(port, '127.0.0.1', () => {
    console.log(`prreview daemon 已啟動：http://127.0.0.1:${port}`)
    console.log(`Claude：${claudeAvailable ? '可用' : '不可用'}`)
    console.log(`Codex：${codexAvailable ? '可用' : '不可用'}`)
    console.log(`token：${token}`)
    console.log('把上面這串 token 貼進插件設定（見 prreview/README.md）。')
  })
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  main()
}
```

- [x] **Step 4: 執行測試確認通過**

Run: `cd prreview/daemon && node --test test/server.test.js`
Expected: PASS，17 個測試全過

- [x] **Step 5: 執行 daemon 完整測試**

Run: `cd prreview/daemon && node --test`
Expected: PASS，Task 1／2／3／5A／6／7 的測試全數通過

- [ ] **Step 6: 手動啟動驗證**

Run: `cd prreview/daemon && npm start`
Expected: 印出啟動訊息、Claude／Codex 可用狀態與 token；缺少其中一個 CLI 不會阻止 daemon 啟動。另開一個終端機執行 `curl http://127.0.0.1:7797/health`，應得到 `{"ok":true}`。按 Ctrl+C 結束。

- [ ] **Step 7: Commit**

```bash
git add prreview/daemon/server.js prreview/daemon/test/server.test.js
git commit -m "feat(prreview): 新增 daemon HTTP server 與 SSE 推送 [no-issue]"
```

---

### Task 8: 插件外殼與側邊欄注入

這個任務先用假資料把 UI 做出來，下一個任務才接真 daemon。這樣切的理由：排版問題與連線問題分開除錯，比混在一起快得多。

**Files:**
- Create: `prreview/extension/manifest.json`
- Create: `prreview/extension/settings.js`
- Create: `prreview/extension/sidebar.css`
- Create: `prreview/extension/sidebar.js`
- Create: `prreview/extension/content.js`
- Create: `prreview/extension/icons/icon16.png`、`icon48.png`、`icon128.png`

**Interfaces:**
- Consumes: `parsePrUrl` (Task 4)
- Produces:
  - `createSidebar(root: ShadowRoot): { setState(state): void, setAgent(agent): void, getAgent(): string, onAgentChange(fn): void, onReview(fn): void }`
  - `state` 為下列之一：
    - `{ phase: 'idle' }`
    - `{ phase: 'running', progress: string }`
    - `{ phase: 'results', summary: string, findings: Finding[] }`
    - `{ phase: 'raw', text: string }`
    - `{ phase: 'error', message: string }`
  - `getSettings(): Promise<{ daemonUrl: string, token: string, agent: 'claude'|'codex' }>`
  - `setAgent(agent): Promise<void>`

- [x] **Step 1: 建立 manifest**

`prreview/extension/manifest.json`：

```json
{
  "manifest_version": 3,
  "name": "prreview",
  "version": "0.1.0",
  "description": "在 Azure DevOps PR 頁面上取得 AI 審核意見。",
  "permissions": ["storage"],
  "host_permissions": ["https://dev.azure.com/*"],
  "content_scripts": [
    {
      "matches": ["https://dev.azure.com/*"],
      "js": ["content.js"],
      "type": "module",
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["sidebar.css"],
      "matches": ["https://dev.azure.com/*"]
    }
  ],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

- [x] **Step 2: 準備 icon**

從 `devkit/icons/` 複製三個尺寸當暫用圖示（M3 再換成專屬圖示）：

```bash
mkdir -p prreview/extension/icons
cp devkit/icons/icon16.png devkit/icons/icon48.png devkit/icons/icon128.png prreview/extension/icons/
```

- [x] **Step 3: 寫設定讀取**

`prreview/extension/settings.js`：

```js
const DEFAULTS = {
  daemonUrl: 'http://127.0.0.1:7797',
  token: '',
  agent: 'claude',
}

export async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS)
  const merged = { ...DEFAULTS, ...stored }
  if (merged.agent !== 'claude' && merged.agent !== 'codex') merged.agent = 'claude'
  return merged
}

export async function setAgent(agent) {
  if (agent !== 'claude' && agent !== 'codex') throw new Error('未知的 Agent')
  await chrome.storage.local.set({ agent })
}
```

M1 沒有獨立設定頁，token 用 DevTools 手動塞入；Agent 直接在側邊欄選擇並保存。

- [x] **Step 4: 寫樣式**

`prreview/extension/sidebar.css`：

```css
:host {
  all: initial;
}

.panel {
  position: fixed;
  top: 0;
  right: 0;
  width: 380px;
  height: 100vh;
  overflow-y: auto;
  box-sizing: border-box;
  padding: 16px;
  background: #1e1e1e;
  color: #e0e0e0;
  font: 13px/1.6 "Segoe UI", system-ui, sans-serif;
  border-left: 1px solid #3c3c3c;
  z-index: 2147483000;
}

.title {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 12px;
}

.agent-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0 0 12px;
}

select.agent {
  flex: 1;
  padding: 6px;
  color: #e0e0e0;
  background: #252526;
  border: 1px solid #3c3c3c;
  border-radius: 3px;
  font: inherit;
}

button.review {
  width: 100%;
  padding: 8px;
  background: #0e639c;
  color: #fff;
  border: 0;
  border-radius: 3px;
  cursor: pointer;
  font: inherit;
}

button.review:disabled {
  background: #3c3c3c;
  cursor: default;
}

.progress {
  margin-top: 12px;
  color: #9cdcfe;
  font-family: Consolas, monospace;
  font-size: 12px;
  word-break: break-all;
}

.summary {
  margin-top: 12px;
  padding: 10px;
  background: #252526;
  border-radius: 3px;
}

.finding {
  margin-top: 10px;
  padding: 10px;
  background: #252526;
  border-left: 3px solid #808080;
  border-radius: 0 3px 3px 0;
}

.finding[data-severity="blocker"] { border-left-color: #f14c4c; }
.finding[data-severity="major"]   { border-left-color: #cca700; }
.finding[data-severity="minor"]   { border-left-color: #3794ff; }
.finding[data-severity="nit"]     { border-left-color: #808080; }

.finding .where {
  font-family: Consolas, monospace;
  font-size: 11px;
  color: #858585;
  word-break: break-all;
}

.finding .headline {
  font-weight: 600;
  margin: 4px 0;
}

.finding .body {
  white-space: pre-wrap;
}

.error {
  margin-top: 12px;
  padding: 10px;
  background: #5a1d1d;
  border-radius: 3px;
  white-space: pre-wrap;
}

.raw {
  margin-top: 12px;
  white-space: pre-wrap;
  font-family: Consolas, monospace;
  font-size: 12px;
}
```

- [x] **Step 5: 寫側邊欄渲染**

`prreview/extension/sidebar.js`：

```js
const SEVERITY_ORDER = { blocker: 0, major: 1, minor: 2, nit: 3 }

export function createSidebar(root) {
  const panel = document.createElement('div')
  panel.className = 'panel'

  const title = document.createElement('h1')
  title.className = 'title'
  title.textContent = 'AI Review'

  const agentRow = document.createElement('label')
  agentRow.className = 'agent-row'
  agentRow.append(document.createTextNode('Agent'))

  const agentSelect = document.createElement('select')
  agentSelect.className = 'agent'
  for (const [value, label] of [['claude', 'Claude'], ['codex', 'Codex']]) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    agentSelect.append(option)
  }
  agentRow.append(agentSelect)

  const button = document.createElement('button')
  button.className = 'review'
  button.type = 'button'
  button.textContent = '開始審核'

  const content = document.createElement('div')
  content.className = 'content'

  panel.append(title, agentRow, button, content)
  root.append(panel)

  function renderFinding(finding) {
    const el = document.createElement('div')
    el.className = 'finding'
    el.dataset.severity = finding.severity

    const where = document.createElement('div')
    where.className = 'where'
    where.textContent = finding.line ? `${finding.file}:${finding.line}` : finding.file

    const headline = document.createElement('div')
    headline.className = 'headline'
    headline.textContent = `[${finding.severity}] ${finding.title}`

    const body = document.createElement('div')
    body.className = 'body'
    body.textContent = finding.body

    el.append(where, headline, body)
    return el
  }

  function note(className, text) {
    const el = document.createElement('div')
    el.className = className
    el.textContent = text
    return el
  }

  function setState(state) {
    content.replaceChildren()
    button.disabled = state.phase === 'running'
    agentSelect.disabled = state.phase === 'running'

    if (state.phase === 'idle') return
    if (state.phase === 'running') {
      content.append(note('progress', state.progress))
      return
    }
    if (state.phase === 'error') {
      content.append(note('error', state.message))
      return
    }
    if (state.phase === 'raw') {
      content.append(note('raw', state.text))
      return
    }
    if (state.phase === 'results') {
      if (state.summary) content.append(note('summary', state.summary))
      const sorted = [...state.findings].sort(
        (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
      )
      if (sorted.length === 0) {
        content.append(note('summary', '沒有發現問題。'))
        return
      }
      for (const finding of sorted) content.append(renderFinding(finding))
    }
  }

  return {
    setState,
    setAgent(agent) {
      agentSelect.value = agent === 'codex' ? 'codex' : 'claude'
    },
    getAgent() {
      return agentSelect.value
    },
    onAgentChange(fn) {
      agentSelect.addEventListener('change', () => fn(agentSelect.value))
    },
    onReview(fn) {
      button.addEventListener('click', fn)
    },
  }
}
```

全部用 `textContent` 而非 `innerHTML` 填內容。findings 的文字來自 LLM 對 PR 內容的轉述，而 PR 內容是外部輸入——用 `innerHTML` 等於把它當成可信的 HTML 執行。

- [x] **Step 6: 寫注入邏輯（先接假資料）**

`prreview/extension/content.js`：

```js
import { parsePrUrl } from './prurl.js'
import { createSidebar } from './sidebar.js'
import { getSettings, setAgent } from './settings.js'

const PANEL_WIDTH = '380px'

let sidebar = null
let host = null

const FAKE_RESULT = {
  phase: 'results',
  summary: '（假資料）整體看起來合理。',
  findings: [
    {
      file: 'src/OrderService.cs',
      line: 42,
      severity: 'blocker',
      title: '可能的 null reference',
      body: 'customer 在第 38 行可能為 null，第 42 行直接取用其屬性。',
    },
    {
      file: 'src/OrderService.cs',
      line: 91,
      severity: 'nit',
      title: '變數命名可更明確',
      body: 'tmp 沒有說明用途。',
    },
  ],
}

function mount() {
  if (host) return

  host = document.createElement('div')
  host.id = 'prreview-host'
  const shadow = host.attachShadow({ mode: 'open' })

  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = chrome.runtime.getURL('sidebar.css')
  shadow.append(link)

  document.body.append(host)
  document.body.style.marginRight = PANEL_WIDTH

  sidebar = createSidebar(shadow)
  sidebar.setState({ phase: 'idle' })
  void getSettings().then((settings) => sidebar?.setAgent(settings.agent))
  sidebar.onAgentChange((agent) => void setAgent(agent))
  sidebar.onReview(() => sidebar.setState(FAKE_RESULT))
}

function unmount() {
  if (!host) return
  host.remove()
  host = null
  sidebar = null
  document.body.style.marginRight = ''
}

function sync() {
  if (parsePrUrl(location.href)) mount()
  else unmount()
}

// Azure DevOps 是 SPA，換頁不會重新載入 content script。
// 監看整份文件的變動來偵測網址變化，成本低於攔截 history API。
let lastUrl = location.href
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href
    sync()
  }
}).observe(document, { subtree: true, childList: true })

sync()
```

- [ ] **Step 7: 手動驗收**

1. Chrome 開 `chrome://extensions`，開啟「開發人員模式」，「載入未封裝項目」選 `prreview/extension`
2. 開啟任一 Azure DevOps PR 頁面

Expected:
- 右側出現深色面板，頁面內容被推開而非被蓋住
- Agent 下拉選單可切換 Claude／Codex，重新整理後保留選擇；執行中不可切換
- 按「開始審核」後出現兩則假 findings，blocker 排在 nit 前面，左側色條顏色不同
- 導覽到 PR 列表頁（非 PR 詳細頁），面板消失且版面復原
- 再點進任一 PR，面板重新出現
- 面板樣式不受 Azure DevOps CSS 影響，Azure DevOps 版面也沒有被插件樣式破壞

- [ ] **Step 8: Commit**

```bash
git add prreview/extension/manifest.json prreview/extension/settings.js prreview/extension/sidebar.css prreview/extension/sidebar.js prreview/extension/content.js prreview/extension/icons
git commit -m "feat(prreview): 新增側邊欄注入與渲染 [no-issue]"
```

---

### Task 9: 串接 daemon（端到端）

**Files:**
- Create: `prreview/extension/client.js`
- Modify: `prreview/extension/content.js`（替換 Task 8 的假資料）

**Interfaces:**
- Consumes: `getSettings` (Task 8)、daemon 的 `/review` 與 `/jobs/:id/events` (Task 7)
- Produces:
  - `startReview(pr, settings): Promise<string>` — 回傳 jobId
  - `streamJob(jobId, settings, onEvent): Promise<void>` — 逐事件呼叫 `onEvent`，串流結束才 resolve

- [x] **Step 1: 寫 daemon 客戶端**

`prreview/extension/client.js`：

```js
export async function startReview(pr, settings) {
  const res = await fetch(`${settings.daemonUrl}/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PRReview-Token': settings.token,
    },
    body: JSON.stringify({ ...pr, agent: settings.agent }),
  })
  if (res.status === 401) {
    throw new Error('token 無效。請確認已貼上 daemon 啟動時印出的 token。')
  }
  if (!res.ok) throw new Error(`daemon 回應 ${res.status}`)
  const { jobId } = await res.json()
  return jobId
}

export async function streamJob(jobId, settings, onEvent) {
  const res = await fetch(`${settings.daemonUrl}/jobs/${encodeURIComponent(jobId)}/events`, {
    headers: { 'X-PRReview-Token': settings.token },
  })
  if (!res.ok) throw new Error(`無法訂閱進度：${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let split
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, split)
      buffer = buffer.slice(split + 2)
      const line = frame.split('\n').find((l) => l.startsWith('data: '))
      if (!line) continue
      try {
        onEvent(JSON.parse(line.slice(6)))
      } catch {
        // 壞掉的 frame 直接跳過，不中斷整個串流
      }
    }
  }
}
```

不用瀏覽器內建的 `EventSource`：它沒辦法帶自訂 header，token 就送不出去。改用 `fetch` 手動解析 SSE frame。

- [x] **Step 2: 接上側邊欄**

修改 `prreview/extension/content.js`：

1. `getSettings` 已在 Task 8 匯入；在檔案頂端的 import 區再補上 daemon client：

```js
import { startReview, streamJob } from './client.js'
```

2. 刪除 `FAKE_RESULT` 常數。

3. 把 `sidebar.onReview(() => sidebar.setState(FAKE_RESULT))` 整行換成：

```js
  sidebar.onReview(async () => {
    const pr = parsePrUrl(location.href)
    if (!pr) return

    const settings = { ...(await getSettings()), agent: sidebar.getAgent() }
    if (!settings.token) {
      sidebar.setState({
        phase: 'error',
        message: '尚未設定 token。請依 README 的說明貼上 daemon 啟動時印出的 token。',
      })
      return
    }

    sidebar.setState({ phase: 'running', progress: '連線中…' })

    try {
      const jobId = await startReview(pr, settings)
      await streamJob(jobId, settings, (event) => {
        if (event.kind === 'tool') {
          sidebar.setState({
            phase: 'running',
            progress: event.detail ? `${event.tool} → ${event.detail}` : event.tool,
          })
        } else if (event.kind === 'text') {
          sidebar.setState({ phase: 'running', progress: event.text })
        } else if (event.kind === 'error') {
          sidebar.setState({ phase: 'error', message: event.message })
        } else if (event.kind === 'done') {
          sidebar.setState(
            event.result.ok
              ? { phase: 'results', summary: event.result.summary, findings: event.result.findings }
              : { phase: 'raw', text: event.result.raw }
          )
        }
      })
    } catch (err) {
      const offline = err instanceof TypeError
      sidebar.setState({
        phase: 'error',
        message: offline
          ? 'daemon 未連線。請先執行：cd prreview/daemon && npm start'
          : err.message,
      })
    }
  })
```

`fetch` 連不上本機 server 時拋的是 `TypeError`，用它區分「daemon 沒開」與「daemon 回錯」——兩者要給的提示完全不同。

- [ ] **Step 3: 設定 token**

啟動 daemon 取得 token：

```bash
cd prreview/daemon && npm start
```

複製印出的 token。在 Azure DevOps PR 分頁按 F12 開 Console，執行（把 `<TOKEN>` 換掉）：

```js
chrome.storage.local.set({ token: '<TOKEN>' })
```

M1 刻意不做完整設定頁；Agent 可直接在側邊欄選擇 Claude 或 Codex。

- [ ] **Step 4: 端到端手動驗收**

在 `chrome://extensions` 重新載入插件，開啟一個真實的 PR，分別選 Claude 與 Codex 後按「開始審核」。

Expected:
1. 兩個 Agent 的進度區都會即時跳動，顯示 `repo_pull_request`、`repo_file → src/...` 這類共同格式訊息
2. 兩者都能在數分鐘後顯示總評與 findings 清單，依 severity 排序
3. findings 內容確實對應該 PR 的實際變更，不是泛泛之談
4. Codex 執行記錄沒有非白名單 MCP 或 file change；任何 command execution 都受 read-only sandbox 限制

- [ ] **Step 5: 驗證失敗路徑**

1. 停掉 daemon（Ctrl+C），重新整理 PR 頁面，按「開始審核」
   Expected: 顯示「daemon 未連線。請先執行：cd prreview/daemon && npm start」
2. 重開 daemon，在 Console 執行 `chrome.storage.local.set({ token: 'wrong' })`，重新整理後按「開始審核」
   Expected: 顯示 token 無效的訊息，而非未處理的例外
3. 把正確 token 設回去，確認恢復正常
4. 選擇未安裝的 Agent 或暫時把其 path 指向不存在的位置
   Expected: 明確指出找不到 `claude` 或 `codex`，另一個 Agent 仍可正常使用
5. Codex 未設定 `azure-devops` MCP
   Expected: 明確提示執行 `codex mcp` 設定，不得靜默改用其他工具完成 review

- [ ] **Step 6: Commit**

```bash
git add prreview/extension/client.js prreview/extension/content.js
git commit -m "feat(prreview): 串接 daemon 完成端到端審核流程 [no-issue]"
```

---

### Task 10: README 與 M1 收尾

**Files:**
- Create: `prreview/README.md`

**Interfaces:**
- Consumes: 全部
- Produces: 無程式介面

- [x] **Step 1: 寫 README**

`prreview/README.md`：

```markdown
# prreview

在 Azure DevOps 的 PR 頁面上取得 AI 審核意見。

插件偵測目前開啟的 PR，呼叫本機的 daemon，daemon 再依側邊欄選擇驅動 `claude` 或 `codex` CLI——透過所選 CLI 的 `azure-devops` MCP 取得 PR 內容並產出結構化的審核意見。

**審核過程全程唯讀，不會對 PR 做任何寫入。**

## 需求

- Node.js 20 以上
- 至少安裝並登入一個支援的 Agent：`claude` CLI 或 `codex` CLI
- 所選 Agent 已設定 `azure-devops` MCP；Codex 可用 `codex mcp get azure-devops --json` 驗證
- Chrome 或 Edge

## 安裝

### 1. 啟動 daemon

    cd prreview/daemon
    npm start

首次啟動會在 `~/.prreview/token` 產生一組 token 並印在畫面上。複製它。

daemon 預設監聽 `127.0.0.1:7797`，只接受本機連線。可用環境變數調整：

- `PRREVIEW_PORT` — 監聽埠號
- `PRREVIEW_CLAUDE` — `claude` 執行檔路徑（不在 PATH 時需要）
- `PRREVIEW_CODEX` — `codex` 執行檔路徑（不在 PATH 時需要）

### 2. 載入插件

1. 開啟 `chrome://extensions`
2. 開啟右上角的「開發人員模式」
3. 點「載入未封裝項目」，選擇 `prreview/extension` 資料夾

### 3. 設定 token

M1 尚無設定頁面。開啟任一 Azure DevOps 分頁，按 F12 開 Console，執行：

    chrome.storage.local.set({ token: '貼上剛才複製的 token' })

重新整理頁面即可。

## 使用

開啟任一 PR 頁面（網址形如 `https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}`），右側會出現面板。先從 Agent 下拉選單選擇 Claude 或 Codex，再按「開始審核」；選擇會保存，進度即時顯示，完成後列出依嚴重度排序的意見。

一次審核約需數分鐘，會消耗所選 Agent 帳號的額度。

## severity 說明

| 等級 | 意義 |
|------|------|
| `blocker` | 會造成資料錯誤、安全漏洞或服務中斷，不修不能合併 |
| `major` | 明確的缺陷，但影響範圍有限 |
| `minor` | 值得改，但不修也不會出事 |
| `nit` | 吹毛求疵，作者可自行判斷 |

## 疑難排解

| 症狀 | 處理 |
|------|------|
| 面板沒出現 | 確認網址是 PR **詳細頁**而非列表頁；確認網域是 `dev.azure.com` |
| 「daemon 未連線」 | 確認 daemon 正在執行，且埠號與插件設定一致 |
| 「token 無效」 | 重新複製 `~/.prreview/token` 的內容，依上方步驟 3 重設 |
| 找不到 Claude | 設定 `PRREVIEW_CLAUDE` 指向 `claude` 執行檔的完整路徑，或改選 Codex |
| 找不到 Codex | 設定 `PRREVIEW_CODEX` 指向 `codex` 執行檔的完整路徑，或改選 Claude |
| Codex 找不到 azure-devops MCP | 先用 `codex mcp get azure-devops --json` 檢查設定 |
| 結果顯示為一大段純文字 | Agent 沒有照 JSON 格式輸出，內容仍完整保留。偶發可重跑；頻繁發生請回報 |

## 安全性

daemon 能啟動具備檔案與 MCP 存取權的 agent，因此：

- 只監聽 `127.0.0.1`，外部網路無法連入
- 每個請求都必須帶正確的 token，驗證在任何動作之前執行
- CORS 只開放給 `https://dev.azure.com`
- Claude 只開放 Azure DevOps 唯讀工具
- Codex 使用 read-only sandbox 與隔離設定，只重新注入 Azure DevOps 唯讀工具

token 等同於「在你機器上啟動 agent」的權限，請勿外流。

## 開發

    cd prreview/daemon && node --test
    cd prreview/extension && node --test

設計文件見 `docs/superpowers/specs/`，實作計畫見 `docs/superpowers/plans/`。

## 目前範圍（M1）

已完成：PR 偵測、Claude／Codex 選擇、AI 審核、結構化意見顯示。

尚未實作（規劃於 M2／M3）：把意見發成 PR 留言、設定頁 UI、自訂審核指示、取消按鈕、結果快取。
```

- [x] **Step 2: 全測試複驗**

Run:

```bash
cd prreview/daemon && node --test
cd ../extension && node --test
```

Expected: 兩邊皆 PASS，無任何失敗

- [ ] **Step 3: 確認沒有殘留檔案**

Run: `git status --porcelain prreview`
Expected: 只剩 README.md 未追蹤；`scratch-run.js` 與 `scratch-missing.js` 應已在 Task 5 刪除

- [ ] **Step 4: Commit**

```bash
git add prreview/README.md
git commit -m "docs(prreview): 新增安裝與使用說明 [no-issue]"
```

---

## M1 驗收標準

全部滿足才算 M1 完成：

- [ ] `prreview/daemon` 與 `prreview/extension` 的 `node --test` 全數通過
- [ ] 側邊欄可選 Claude／Codex，重新整理後保留選擇，執行中不可切換
- [ ] 在同一個真實 PR 分別選 Claude 與 Codex，都能看到即時進度並在數分鐘內得到 findings
- [ ] 兩個 Agent 的 findings 都確實對應該 PR 的實際變更
- [ ] daemon 未啟動、token 錯誤、所選 CLI 不存在、Codex MCP 未設定都有明確可行動的訊息
- [ ] Codex 執行時只載入 Azure DevOps 唯讀 MCP，沒有 file change；任何 command execution 都受 read-only sandbox 限制
- [ ] 導覽到非 PR 頁面時面板消失且版面復原
- [ ] 全程沒有對 PR 產生任何寫入

## M1 之後

**M1 的目的是回答「AI review 的品質夠不夠用」。** 拿到答案再決定下一步：

- 品質夠用 → 進入 M2（發 PR 留言、設定頁、取消按鈕）
- 品質不足 → 先調整 `prompts/review.md`，或重新檢視「不給本機 clone」這個決策，**而不是繼續堆 UI**

M2 與 M3 各自會有獨立的計畫文件。
