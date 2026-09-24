# prreview

在 Azure DevOps Cloud 的 Pull Request 詳細頁中，透過瀏覽器側邊欄啟動本機 AI code review。瀏覽器 extension 只負責辨識 PR、顯示進度與結果；Node.js daemon 會呼叫本機的 Claude 或 Codex CLI，讓 CLI 透過已設定的 Azure DevOps MCP 讀取 PR 內容。

目前的審核流程是唯讀的：它不會修改 repository、建立 commit，也沒有把 finding 自動寫回 PR 的功能。

## 目前功能

- 支援 Azure DevOps Cloud 的 dev.azure.com 與 *.visualstudio.com PR 網址。
- 側邊欄可選 Claude 或 Codex，選擇會保存於瀏覽器的 chrome.storage.local；重新整理或重新進入 PR 後會沿用上次選擇。
- 側邊欄「設定」區的展開／收合狀態也會保存於瀏覽器；重新整理或重新進入 PR 後會沿用上次狀態。
- 審核進度透過 SSE 即時顯示，完成後以中文顯示結論、severity 分級、說明與 findings 數量。
- 審核結果會保存於本機，進入不同 PR 時只顯示該 PR 的歷史紀錄；可點選歷史項目重新查看結果。
- 側邊欄可以用滑鼠拖曳左側邊界調整寬度，也可以用左右方向鍵、Home、End 調整。
- 側邊欄可關閉，開啟／關閉狀態會保存於瀏覽器；關閉後右下角的 AI 圖示可以重新開啟，下一次進入 PR 時會沿用上次狀態。
- daemon 只在本機 loopback 監聽，使用隨機 token 保護請求。
- 解析不到結構化 JSON 時，側邊欄會保留 Agent 回傳的原始文字，避免結果直接消失。

## 需求

- Node.js 20 以上。
- 已安裝並完成登入的 Claude CLI 或 Codex CLI，至少需要其中一個。
- CLI 已設定 Azure DevOps MCP。Codex 可用下列指令確認：

    codex mcp get azure-devops --json

- Chrome 或 Edge。

Agent 選單選的是 CLI provider，不是特定模型名稱。目前 UI 沒有模型選擇器；Claude 與 Codex 會使用各自 CLI 的預設或本機設定模型。要更換模型，請依所用 CLI 的設定方式處理。

## 安裝與啟動 daemon

### 手動啟動

在專案根目錄執行：

    cd daemon
    npm start

daemon 預設監聽 http://127.0.0.1:7797。

### Windows 一鍵啟動

直接雙擊專案根目錄的 start-daemon.cmd。腳本會在另一個視窗啟動 daemon，並預設使用 %USERPROFILE%/.prreview 作為設定目錄；確認 token 檔案建立後，會自動呼叫 scripts/copy-token.cmd 將 token 放入剪貼簿。啟動腳本完成後即可直接在側邊欄的 Token 欄位按 Ctrl+V。

也可以在 extension 側邊欄的「設定」儲存 start-daemon.cmd 所在資料夾路徑。之後按「複製路徑」，再貼到檔案總管的網址列即可開啟該資料夾。

copy-token.cmd 不會把 token 印到畫面上；它會使用 Windows 原生剪貼簿指令，並保留 PowerShell 剪貼簿 API 作為 fallback。若要再次複製，可直接雙擊 scripts/copy-token.cmd。

### Token 生命週期

- token 是 32 bytes 隨機值，以 64 個小寫十六進位字元儲存。
- 預設檔案是 %USERPROFILE%/.prreview/token；設定 PRREVIEW_CONFIG_DIR 後會改用該目錄。
- daemon 會重複使用已存在的 token，因此重新啟動 daemon 不會讓瀏覽器設定失效。
- 要輪替 token，請先停止 daemon，再刪除 token 檔並重新啟動；新的 token 需要重新貼入側邊欄。
- 這個 token 只保護瀏覽器與本機 daemon 的 HTTP 連線，不取代 Azure DevOps、Claude 或 Codex CLI 的登入認證。

### 環境變數

- PRREVIEW_PORT：daemon 監聽的連接埠，預設 7797。
- PRREVIEW_CONFIG_DIR：token 儲存目錄，預設 %USERPROFILE%/.prreview。
- PRREVIEW_CLAUDE：Claude CLI 可執行檔路徑，預設 claude。
- PRREVIEW_CLAUDE_MCP_CONFIG：Claude MCP JSON 設定檔路徑，預設 ~/.claude.json。
- PRREVIEW_CODEX：Codex CLI 可執行檔路徑，預設 codex。

啟動時 daemon 會檢查兩個 CLI 是否存在；其中一個未安裝不會阻止另一個 provider 使用。

## 載入瀏覽器 extension

1. 開啟 chrome://extensions。
2. 開啟「開發人員模式」。
3. 選擇「載入未封裝項目」，指定本專案的 extension 目錄。
4. 開啟支援的 Azure DevOps PR 詳細頁。
5. 在側邊欄的「設定」區輸入 daemon URL 與 token，按「儲存設定」；可按「測試連線」確認 token 有效。

Chrome 142 以上第一次由 Azure DevOps 連到 127.0.0.1 時，可能顯示「本機網路存取」權限提示。請允許該提示，頁面才能連到 daemon。

自架 Azure DevOps Server 與其他網域目前不在支援範圍。

## 使用審核

1. 確認側邊欄的 Agent 選擇正確。選擇變更會立即保存到瀏覽器；執行中的審核不能切換 Agent。
2. 按「開始審核」。
3. 等待工具呼叫與文字進度。完成後會顯示「目前 PR 可通過」或「需要修改後再通過」、總評與 findings。
4. 若 Agent 沒有回傳可解析的 JSON，側邊欄會改顯示原始文字，方便診斷 prompt 或 CLI 輸出問題。

審核結果會寫入設定目錄的 `history.json`，依 organization、project、repository 與 PR 編號分區。執行中的 job 仍只存在於 daemon 記憶體；完成後可在相同 PR 頁面查詢歷史。

## daemon API

所有需要操作的 endpoint 都要在 HTTP header 帶上 X-PRReview-Token。

- GET /health：健康檢查，不需要 token。
- GET /auth：驗證 token。
- POST /review：建立或重用相同 PR 與 Agent 的執行中 job。body 包含 org、project、repo、prId、agent。
- GET /jobs/{jobId}/events：以 SSE 讀取即時進度與最後結果。
- GET /history?org=...&project=...&repo=...&prId=...：讀取目前 PR 的歷史結果。

目前沒有 /comment 或其他寫入 PR 的 endpoint。

## 審核安全界線

- daemon 固定綁定 127.0.0.1，不接受外部網路介面連線。
- 除 /health 外的請求都先驗證 token；token 不放在 URL 或 request body。
- CORS 只允許 Azure DevOps Cloud origin，並支援瀏覽器的本機網路存取預檢。
- Claude 使用 temporary MCP config、restricted、strict-mcp-config、disable tools 與 allowedTools，只注入五個 Azure DevOps 唯讀工具。
- Codex 使用 ephemeral、sandbox read-only、ignore-user-config、ignore-rules，並以隔離設定只允許 azure-devops 的五個唯讀工具；shell tool 與 multi-agent 功能關閉。
- 審核 prompt 將 PR 內容、repository 文件與 AGENTS.md／CLAUDE.md 視為不可信的資料，這些內容不能提高工具權限或要求執行額外操作。
- 執行中的審核 job 只保存在 daemon 記憶體；完成結果會保存於本機設定目錄，daemon 重啟後仍可查詢。

允許的 Azure DevOps MCP 工具為：

    repo_pull_request
    repo_file
    repo_branch
    repo_repository
    search_code

## 常見問題

### 側邊欄顯示 daemon 無法連線

確認 daemon 視窗仍在執行，並確認 URL 是 http://127.0.0.1:7797。也可以在瀏覽器開啟 http://127.0.0.1:7797/health，預期回傳 {"ok":true}。

### Token 無效

用 scripts/copy-token.cmd 重新複製目前設定目錄的 token。若曾刪除 token 或更換 PRREVIEW_CONFIG_DIR，請把新 token 貼入側邊欄後重新儲存。

### Chrome 顯示本機網路存取提示

在 Azure DevOps 頁面允許該提示，然後重新按「測試連線」。這是瀏覽器對網頁連到本機服務的權限確認。

### Claude 或 Codex 找不到

確認 CLI 在 PATH 中，或設定 PRREVIEW_CLAUDE／PRREVIEW_CODEX 的完整路徑。重新啟動 daemon 後再測試。

### MCP 找不到或 review 立即失敗

Claude 請確認 PRREVIEW_CLAUDE_MCP_CONFIG 指向包含 mcpServers.azure-devops 的 JSON。Codex 請執行 codex mcp get azure-devops --json，確認 server 已啟用且可由 CLI 登入。

### 結果是一大段原始文字

這表示 CLI 有輸出，但沒有符合 findings schema 的 JSON。原始文字仍會顯示在側邊欄；請檢查 CLI 版本、MCP 連線與 daemon console 訊息。

## 開發與驗證

daemon 測試：

    cd daemon
    npm test

extension 測試：

    cd extension
    npm test

目前基準測試為 daemon 94 passed、extension 29 passed。修改後至少應執行兩個測試套件，並確認：

    git diff --check

## 目錄

    prreview/
      daemon/
        server.js       HTTP、CORS、token 與 SSE
        auth.js         token 產生、讀取與安全寫入
        jobs.js         in-memory job 與 SSE 訂閱
        history.js      PR 範圍的歷史結果持久化
        runner.js       Claude／Codex provider facade
        claude.js       Claude MCP 隔離設定
        codex.js        Codex MCP 隔離設定與 JSONL parser
        process.js      child process、取消與清理
        findings.js     findings schema 驗證與 JSON 擷取
        prompts/        review prompt 與 findings schema
        test/           daemon 測試
      extension/
        content.js      content script 入口
        content-module.js  PR 偵測、設定與 review 流程
        sidebar.js      Shadow DOM UI、寬度與開關控制
        sidebar.css     側邊欄樣式
        client.js       daemon HTTP／SSE client
        settings.js     chrome.storage.local 設定與側邊欄偏好
        icons/          extension 與重開按鈕圖示
        test/            extension 測試
      scripts/
        copy-token.cmd
        copy-token.ps1
      start-daemon.cmd
      docs/superpowers/
        specs/
        plans/

## 後續工作

目前仍待規劃或實作的項目：

- 逐則確認後把 finding 寫回 Azure DevOps PR。
- 側邊欄取消目前執行中 job 的操作。
- 自動啟動或真正的背景服務；目前提供的是方便手動啟動的 cmd 腳本。
- 獨立設定頁 UI。
- 自訂 prompt、可配置 severity 規則與模型選擇器。
