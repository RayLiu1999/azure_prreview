# PR AI 審核插件（prreview）— 設計文件

日期：2026-09-16
狀態：M1 已完成主要實作與安全防護；瀏覽器真實 PR 的雙 provider 驗證仍待手動執行。

## 1. 目的

在 Azure DevOps Cloud 的 Pull Request 詳細頁提供一個唯讀 AI code review 面板。使用者可以選擇本機 Claude 或 Codex CLI，讓 daemon 透過 Azure DevOps MCP 讀取 PR 與相關檔案，逐步回報進度，最後顯示結構化 findings。

目前設計刻意不寫回 PR。審核結果只用於當次頁面上的人工判斷；comment、歷史結果與自動修正屬於後續範圍。

## 2. 範圍與決策

| 項目 | 目前決策 | 原因 |
| --- | --- | --- |
| 目標平台 | Chrome／Edge Manifest V3 | extension 只需掛在 Azure DevOps PR 頁面 |
| Azure DevOps | Cloud：dev.azure.com 與 *.visualstudio.com | 目前需求集中在團隊使用的 Cloud instance |
| 執行位置 | 本機 Node.js daemon | CLI、MCP 登入狀態與長時間 job 不適合放在 extension |
| 連線方式 | content script 直連 localhost daemon + SSE | 避免 MV3 service worker 生命週期中斷長時間 review |
| Agent 選擇 | claude 或 codex，預設 claude | 每次 review 可選 provider；選擇保存於 chrome.storage.local |
| 模型選擇 | 暫不提供模型欄位 | provider 直接使用本機 CLI 的預設或設定模型，避免複製 CLI 設定 |
| 審核輸入 | PR 識別資料與 repository 內容 | 不 clone repository，也不直接操作 Azure DevOps DOM |
| 審核輸出 | summary + findings JSON；解析失敗時保留 raw text | UI 可以排序與逐則閱讀，也保留診斷資訊 |
| 寫回 PR | 目前不提供 | review 全程唯讀，避免誤留言或權限擴大 |
| UI | 右側 Shadow DOM 面板，可調寬度、可收合 | 不污染 Azure DevOps CSS；收合後由右下角圖示重開 |
| daemon 安全 | 127.0.0.1 + X-PRReview-Token + CORS allowlist | 限制本機與允許的 Azure DevOps origin |
| 啟動方式 | npm start；Windows 另提供 start-daemon.cmd | 腳本在另一個視窗啟動 daemon，等 token 建立後自動複製；尚未做服務化 |

## 3. 元件架構

    Azure DevOps PR page
      └─ content.js / content-module.js
           ├─ parsePrUrl()
           ├─ settings.js  ←→ chrome.storage.local
           ├─ client.js    ←→ POST /review、GET /jobs/.../events
           └─ sidebar.js   ←→ Shadow DOM UI
                               │
                               ▼
                     http://127.0.0.1:7797
                               │
                       daemon/server.js
                               ├─ auth.js
                               ├─ jobs.js
                               └─ runner.js
                                  ├─ claude.js → Claude CLI + temporary MCP config
                                  └─ codex.js  → Codex CLI + isolated MCP config

daemon 不依賴 extension 的 service worker。job 在 daemon 記憶體中執行與保留有限完成記錄；daemon 重啟後 job 與結果都會消失。

## 4. Review data flow

1. content script 用 parsePrUrl 從目前 URL 取得 org、project、repo、prId。
2. 使用者在側邊欄儲存 daemon URL 與 token，並選擇 claude 或 codex。
3. client.js 以 X-PRReview-Token 呼叫 POST /review；daemon 驗證 body 後建立或重用相同 PR 與 Agent 的 running job。
4. runner.js 讀取 prompts/review.md，建立 provider 的隔離 MCP 設定，再啟動 CLI。
5. CLI 只透過 Azure DevOps MCP 讀取 PR、branch、repository、file 與 code search 資料。
6. process.js 與 stream.js／codex.js 將 CLI 輸出轉為 tool、text、error、done 事件。
7. jobs.js 發布事件；server.js 以 SSE 傳給 extension。
8. client.js 解析事件。findings.js 從最後結果擷取並驗證 summary 與 findings；解析失敗時回傳 raw text。

## 5. Daemon API

| 方法 | 路徑 | 認證 | 用途 |
| --- | --- | --- | --- |
| GET | /health | 不需要 | 確認 daemon 存活 |
| GET | /auth | token | 測試瀏覽器設定是否有效 |
| POST | /review | token | 建立 review job |
| GET | /jobs/{jobId}/events | token | 讀取 SSE 進度與結果 |

POST /review 只接受：

    {
      "org": "organization",
      "project": "project",
      "repo": "repository",
      "prId": 123,
      "agent": "claude"
    }

org、project、repo 會拒絕空值、控制字元、斜線與過長輸入；prId 必須是正整數；agent 只能是 claude 或 codex。API 沒有寫回 PR 的 endpoint。

## 6. Provider 與隔離

### Claude

- 使用 restricted、strict-mcp-config、disable-slash-commands、no-session-persistence。
- 從使用者設定讀取 azure-devops server，寫出只含該 server 的 temporary MCP JSON，完成後清理。
- 以 allowedTools 只開放 repo_pull_request、repo_file、repo_branch、repo_repository、search_code。
- 可由內部 runner options 傳入 model，但目前 extension 不暴露模型選擇。

### Codex

- 使用 exec、json、ephemeral、sandbox read-only、skip-git-repo-check。
- 使用 ignore-user-config 與 ignore-rules，重新建立只含 azure-devops 的 MCP 設定。
- 設定 approval_policy=never、features.shell_tool=false、features.multi_agent=false、web_search=disabled。
- MCP server 明確列出五個唯讀工具；file change 等違反事件會被 parser 標記為 violation。
- 使用 output-schema 要求 findings JSON；turn.completed 的最後訊息會交給 findings parser。

## 7. UI 行為

- 面板預設寬度 380px，限制在 280px 至 720px，並依 viewport 夾住最大值。
- 左側 resize handle 支援 pointer drag 與鍵盤方向鍵、Home、End，並同步調整 document.body 的右側 margin。
- 標題列關閉按鈕會隱藏面板；右下角浮動 AI 按鈕會重新開啟。
- PR URL 不再符合格式時，content module 會解除 mount、移除事件與還原原本的 body margin。
- Agent 選擇會立即寫入 chrome.storage.local。初始化設定非同步回來時，如果使用者已先選擇，該選擇不會被舊值覆蓋。
- review 執行中停用 Agent 選單與開始按鈕；目前 UI 沒有取消 job 的按鈕。

## 8. 安全模型

威脅來源包括惡意 PR 內容、repository 內的 prompt injection、其他本機程序與錯誤的 MCP 設定。

- daemon 只 listen 127.0.0.1，不暴露到區域網路。
- token 由 randomBytes(32) 產生，儲存為 64 位小寫 hex；既有 token 會重用，並以建立檔案時的私有模式保護。使用者可刪除 token 檔後重新產生。
- 除 /health 外，請求必須帶 X-PRReview-Token；token 不放在 URL 或 JSON body。
- CORS 只回應 Azure DevOps Cloud allowlist，並處理 Private Network Access 預檢。
- PR 與 repository 文件只是不可信 review data，不能授予更多工具、要求寫檔、執行命令或改變 system boundary。
- Claude 與 Codex 都使用隔離設定與唯讀工具；Codex 額外使用 read-only sandbox 與停用 shell。
- extension 對 finding 使用 textContent，不把 Agent 文字當 HTML 插入。
- daemon 沒有 /comment、git push 或其他副作用 endpoint。

## 9. 錯誤與降級

| 情況 | 行為 |
| --- | --- |
| daemon 未啟動 | extension 顯示連線錯誤與啟動提示 |
| token 錯誤 | /auth、/review、SSE 回傳 401，側邊欄顯示錯誤 |
| 非允許 origin | CORS 預檢或請求回傳 403 |
| CLI 不存在 | daemon 啟動檢查標示 provider 不可用；review job 回報錯誤 |
| MCP 設定缺失 | provider 在啟動前失敗，temporary config 不會殘留 |
| SSE 沒有 terminal event | client 拋出錯誤，不把不完整結果當成功 |
| JSON 不符合 schema | 側邊欄顯示 raw text，保留診斷線索 |
| PR URL 離開詳細頁 | content module unmount，還原頁面 layout |

## 10. 目錄與模組邊界

    prreview/
      daemon/
        server.js、auth.js、jobs.js
        runner.js、process.js
        claude.js、codex.js、stream.js
        prompt.js、findings.js
        prompts/review.md、prompts/findings.schema.json
        test/
      extension/
        content.js、content-module.js
        sidebar.js、sidebar.css
        client.js、settings.js、prurl.js
        manifest.json、icons/
        test/
      scripts/copy-token.cmd
      scripts/copy-token.ps1
      start-daemon.cmd
      README.md
      docs/superpowers/specs/
      docs/superpowers/plans/

runner.js 只負責 provider facade；provider 內含 CLI invocation 與 MCP 隔離；process.js 負責 child process 生命週期；findings.js 只負責結果擷取與 schema 驗證；UI 不直接呼叫 Azure DevOps。

## 11. 驗證與目前狀態

- daemon 單元與整合測試：84 passed。
- extension 測試：25 passed。
- JavaScript syntax check、manifest JSON parse 與 git diff --check 已通過。
- Windows 腳本已驗證 token 不存在時會回報錯誤，不會複製空值。
- 真實 PR 的 Codex 唯讀流程曾用於整合驗證；Claude 的真實 PR 重跑需要另外取得授權後再執行，文件不把未執行的 live run 當成通過。

## 12. 後續里程碑

M2 可處理逐則確認後寫回 comment、取消目前 job、結果持久化與歷史列表。M3 再評估 daemon 服務化、自動啟動、自訂 prompt、severity 規則與模型選擇器。這些項目不應削弱目前的唯讀與本機隔離邊界。
