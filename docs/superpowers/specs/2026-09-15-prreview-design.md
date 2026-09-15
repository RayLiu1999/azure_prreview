# PR AI 審核插件（prreview） — 設計文件

日期：2026-09-15
狀態：已與使用者確認

## 目的

在 Azure DevOps 的 PR 頁面上，一鍵取得 AI code review 的結果，並能逐則決定要不要留言回 PR。

現況的痛點是流程斷裂：看到 PR → 切到終端機 → 想辦法把 PR 內容餵給 Claude → 讀結果 → 切回瀏覽器 → 手動留言。這個插件把整段流程收在 PR 頁面上完成。

核心觀察：**本機的 `claude` 或 `codex` CLI 都可以掛載 `azure-devops` MCP，自己抓 PR、抓檔案，並在明確授權時留言。** 因此插件不需要自己搬運 diff，只需要負責「偵測、觸發、呈現、授權」四件事。

## 決策

| 項目 | 決定 | 理由 |
|------|------|------|
| 目標瀏覽器 | Chrome / Edge，Manifest V3 | 與既有 devkit / notes 插件一致 |
| 目標平台 | 僅 Azure DevOps（`dev.azure.com`） | 唯一實際使用的平台；抽象化跨平台是尚未存在的需求 |
| 使用對象 | 先自用，之後發給團隊 | 不得 hardcode 本機路徑，設定需可調，安裝步驟需文件化 |
| 橋接方式 | 本地 HTTP daemon（Node） | 見下方「為何不用 Native Messaging」 |
| Agent 選擇 | 每次 review 指定 `claude` 或 `codex`；預設 `claude` | M1 在側邊欄提供下拉選單並寫入 `chrome.storage`；M2 在設定頁補預設值管理；不需重啟 daemon |
| 驅動 Agent | Claude：`claude -p --output-format stream-json`；Codex：`codex exec --json --ephemeral --sandbox read-only` | 沿用所選 CLI 的登入與 MCP 設定，不額外管理模型 API key |
| 程式碼視野 | PR diff + 所選 Agent 用 MCP 按需抓檔 | 不需本機 clone，免除「repo → 本機路徑」對應表與 fetch/checkout 的整層複雜度 |
| 產出格式 | 結構化 findings JSON + 一段總評 | 側邊欄需逐則展示、過濾、逐則發留言；純 Markdown 做不到 |
| 寫回 PR | 可以，但必須由人逐則按下 | review 階段的 agent 全程唯讀，不具備留言能力，假警報不可能外洩到同事眼前 |
| 寫回管道 | 再 `spawn` 一次所選 Agent，只暴露 `thread_write` | 沿用所選 CLI 的 Azure DevOps MCP 認證，團隊成員不需額外申請 PAT |
| UI | 右側固定面板，Shadow DOM 隔離，不碰 Azure DevOps 內部 DOM | 見下方「為何不做跳行聯動」 |
| 連線 | content script 直連 daemon + SSE | 見下方「為何不經過 background」 |
| daemon 安全 | 共享 token（HTTP header）+ 只監聽 `127.0.0.1` | 見下方「威脅模型」 |
| 審核準則 | 共用內建 prompt + Agent 自動讀 repo 規範 + 設定頁可追加 | 通用 prompt 產生通用意見；讀得到 `AGENTS.md`／`CLAUDE.md` 等專案規範才貼合實際 |
| 建置工具 | 無。純 HTML/CSS/JS + 零相依 Node | 與 devkit 一致；此規模用打包工具換不到對應價值 |
| 測試 | `node --test`，只測純函式 | 與 devkit 一致 |

### 為何不用 Native Messaging

一次 PR review 會跑數分鐘，而 MV3 的 service worker 約 30 秒無活動即休眠。走 Native Messaging 時，service worker 一睡，`connectNative` 的 port 就中斷、host process 被終止，**進行到一半的 review 直接消失**。要繞過只能靠 keep-alive 心跳硬撐，脆弱且難以除錯。

本地 daemon 讓 job 的生命週期完全脫離瀏覽器：job 活在 daemon 裡，瀏覽器睡了、關了、重開了都不影響。這個生命週期不匹配的問題自然消失。

代價是 daemon 需要有人啟動。接受。

### 為何不經過 background

側邊欄是 content script，只要分頁開著就一直活著，不像 service worker 會休眠。因此讓 content script 直連 daemon，可以完全繞開 service worker 的生命週期問題，同時省下一層訊息轉發。

daemon 需為此把 CORS 開給 Azure DevOps 的 origin。這不構成安全缺口——真正的把關是 token（見威脅模型）。

代價是關掉分頁就收不到進度。但 job 仍活在 daemon 中，重開分頁可重新掛回同一個 job。

### 為何不做跳行聯動

「點一則 finding，左邊 diff 自動捲到該行並 highlight」體驗明顯更好，但必須逆向工程 Azure DevOps 的 diff DOM 與虛擬捲動。那等於簽下一份長期維護合約：微軟每次改版都可能悄悄弄壞它。

第一版只做「固定在右側、推開 body margin」，完全不讀取 Azure DevOps 的內部結構，改版風險接近零。若實際使用後確認跳行聯動的價值夠高，再單獨評估。

### 威脅模型

daemon 能 `spawn` `claude` 或 `codex`，而兩者都可能具備檔案與 MCP 存取權。**瀏覽器不會阻止任意網頁對 `localhost` 發出請求**——它只阻止該網頁讀取回應，但攻擊者根本不需要讀回應，只要能觸發就足以在使用者機器上啟動一個有權限的 agent。

因此：

- daemon 只監聽 `127.0.0.1`，不監聽 `0.0.0.0`
- daemon 啟動時產生隨機 token，寫入本機設定檔並印在 console；使用者將其貼進插件設定頁
- 每個請求必須帶 `X-PRReview-Token`；驗證失敗直接 401，**且在執行任何副作用之前就擋下**
- CORS 的 `Access-Control-Allow-Origin` 只開給 Azure DevOps origin 與插件自身
- Claude review 使用 `--restricted` 加唯讀 MCP 工具白名單
- Codex review 使用 `--sandbox read-only`，並以隔離設定只啟用 `azure-devops` 的唯讀工具；不能只靠 prompt 宣稱唯讀

CORS 本身不是安全機制，token 才是。順序很重要：先驗 token，再做事。

### 明確排除的範圍（YAGNI）

GitHub / GitLab 支援、自架 Azure DevOps Server、跳行聯動、AI 自動留言、daemon 服務化（開機自啟）、結果跨裝置同步、多 PR 批次審核、審核結果的歷史比較、自訂 severity 規則引擎。

其中兩項有明確的重啟條件：

- **跳行聯動**：等第一版實際使用一至兩週，確認「看完意見後真的會想跳到該行」是高頻動作，再開。
- **daemon 服務化**：等要發給團隊時再評估。自用階段 `npm start` 完全夠用，提早做服務化只是在還沒確定介面時就把它凍結。

**AI 自動留言不列入未來規劃**。它把假警報直接推到同事眼前且難以收回，省下的只是按一下的成本。這個交換在任何階段都不划算。

## 檔案結構

```
prreview/
  extension/
    manifest.json
    content.js         注入側邊欄、SSE 連線、事件處理  ← 唯一接觸頁面 DOM
    client.js          daemon HTTP/SSE 客戶端           ← 唯一接觸 fetch
    sidebar.js         側邊欄的渲染與互動（Shadow DOM 內）
    sidebar.css        側邊欄樣式（隨 Shadow DOM 注入）
    prurl.js           PR URL 解析                    ← 純函式，零 chrome 依賴
    settings.js        設定讀寫（daemon URL、token、agent） ← 唯一接觸 chrome.storage
    options.html / options.css / options.js
    icons/
    test/
      prurl.test.js
  daemon/
    package.json
    server.js          HTTP 路由、CORS、token 驗證     ← 唯一接觸網路
    auth.js            token 產生與驗證                ← 純函式
    jobs.js            job 生命週期與 SSE 訂閱管理
    runner.js          選擇 provider、spawn CLI、組 prompt ← 唯一接觸 child_process
    stream.js          Claude stream-json → 進度事件    ← 純函式
    codex.js           Codex 隔離設定、JSONL 解析與執行
    findings.js        findings schema 驗證與正規化     ← 純函式
    prompts/
      review.md        內建審核 prompt
      findings.schema.json  Codex 結構化輸出 schema
    test/
      auth.test.js / stream.test.js / codex.test.js / findings.test.js
  README.md            安裝與使用說明
  docs/superpowers/
```

## 模組邊界

**`prurl.js`（純函式）**

- `parsePrUrl(url)` → `{ org, project, repo, prId } | null`
  - 比對 `https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}`
  - 非 PR 頁面回傳 `null`，側邊欄據此決定顯示或隱藏

**`stream.js`／`codex.js`**

- `parseStreamEvent(line)`／`parseCodexStreamEvent(line)` → `ProgressEvent | null`
  - 把 Claude stream-json 或 Codex `--json` JSONL 事件翻譯成側邊欄看得懂的共同進度格式（「正在讀 X 檔」、「已產生 N 則意見」）
  - 無法辨識的事件回傳 `null`，不得拋錯——CLI 的事件格式會隨版本增減
  - `codex.js` 另外負責讀取使用者的 `azure-devops` MCP 定義，並為 review 建立只含唯讀工具的隔離 invocation

**`findings.js`（純函式）**

- `parseFindings(text)` → `{ ok: true, summary, findings } | { ok: false, raw }`
  - 驗證每則 finding 具備 `file` / `line` / `severity` / `title` / `body`
  - **LLM 不照格式輸出時不得讓整次 review 作廢**：驗證失敗時回傳原始文字，側邊欄降級為顯示純文字

**`runner.js`**

- `runReview(pr, options)` → `{ events: AsyncIterable<ProgressEvent>, cancel(): void }`，其中 `options.agent` 為 `claude` 或 `codex`
- Claude adapter 使用 `--restricted` 與 `--allowedTools`；Codex adapter 使用 `--sandbox read-only`、`--ephemeral` 與隔離 MCP 設定。兩者都只暴露 azure-devops 唯讀工具
- `postComment(pr, finding, options)` → `Promise<void>`：另起一個隔離 process，只暴露 `thread_write`，prompt 為單一明確指令

**`jobs.js`**

- job 存在記憶體即可，daemon 重啟後遺失是可接受的
- 一個 job 可被多個 SSE 訂閱者掛載（同一 PR 開兩個分頁）

## 資料流

```
PR 頁面
  → content.js 以 parsePrUrl 取得 { org, project, repo, prId }
  → fetch POST /review  ({ org, project, repo, prId, agent } + X-PRReview-Token)
daemon
  → jobs.js 建立 job，回傳 jobId
  → runner.js 依 agent spawn：
      claude -p --restricted --output-format stream-json --allowedTools <唯讀工具>
      codex exec --json --ephemeral --sandbox read-only <隔離的唯讀 MCP 設定>
                prompt = prompts/review.md + PR 座標 + 使用者自訂指示
  → stream.js 逐行解析 → SSE 推送進度
content.js  ← GET /jobs/:id/events (SSE)
  → sidebar.js 即時渲染進度，結束後渲染 findings
使用者按下某則的「發成 PR 留言」
  → fetch POST /comment  → runner.postComment
```

## 錯誤處理

| 情境 | 行為 |
|------|------|
| daemon 未啟動 | 側邊欄顯示「daemon 未連線」與啟動指令，不重試轟炸 |
| token 錯誤或未設定 | 側邊欄顯示「請到設定頁貼上 token」並附設定頁連結 |
| 所選 CLI 不在 PATH | 該次 review 立即回傳清楚錯誤，並提示 `PRREVIEW_CLAUDE` 或 `PRREVIEW_CODEX` |
| Agent CLI 非零退出 | 把 stderr 原文帶回側邊欄，不吞掉 |
| Agent 值不是 `claude`／`codex` | daemon 回 400，不啟動 job |
| Codex 找不到 `azure-devops` MCP | 該次 review 失敗並提示先完成 `codex mcp` 設定，不降級成無 MCP 的 review |
| findings 格式不符 | 降級顯示原始文字（見 `findings.js`） |
| 使用者中途取消（M2） | 終止 child process，job 標記為 cancelled。M1 的 runner 已具備 cancel()，但沒有觸發它的 UI |
| 關閉分頁後重開（M2） | 以 PR 座標查詢既有 job 並重新掛載 SSE。M1 不做：重按即重跑 |

## 里程碑

**M1 — 垂直切片**：在 PR 頁面按一下，選用 Claude 或 Codex 後，側邊欄顯示真正的 findings。端到端串通但功能最少。
不含：發留言、獨立設定頁、自訂 prompt、結果快取。token 驗證與 provider 隔離從 M1 就要有（安全機制不補做）；token 先以手動方式寫入 chrome.storage，Agent 則直接在側邊欄選擇並保存。

**M2 — 可用**：發成 PR 留言、設定頁（daemon URL / token / Agent / 自訂指示）、取消按鈕。

**M3 — 可發佈**：README 安裝說明、daemon 啟動檢查、錯誤處理補完、結果快取。

M1 的目的是**盡快回答「AI review 的品質到底夠不夠用」這個問題**。若答案是否定的，後續全部作廢——因此在得到答案之前，不投資任何 UI 打磨或設定介面。
