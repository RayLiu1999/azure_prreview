# prreview

在 Azure DevOps 的 Pull Request 頁面上取得 AI 審核意見。

插件偵測目前開啟的 PR，呼叫本機 daemon；daemon 依側邊欄選擇驅動 `claude` 或 `codex` CLI，透過所選 CLI 的 `azure-devops` MCP 取得 PR 內容並產出結構化 findings。

審核過程全程唯讀，不會對 PR、儲存庫或本機專案內容做寫入。

## 需求

- Node.js 20 以上
- 至少安裝並登入一個支援的 Agent：`claude` CLI 或 `codex` CLI
- 所選 Agent 已設定 `azure-devops` MCP
- Chrome 或 Edge

## 安裝

### 啟動 daemon

```text
cd prreview/daemon
npm start
```

首次啟動會在 `~/.prreview/token` 產生 token 並印在終端機。daemon 預設只監聽 `127.0.0.1:7797`。

可用環境變數調整：

- `PRREVIEW_PORT`：監聽埠號
- `PRREVIEW_CONFIG_DIR`：token 儲存目錄
- `PRREVIEW_CLAUDE`：Claude 執行檔完整路徑
- `PRREVIEW_CLAUDE_MCP_CONFIG`：Claude MCP 設定檔路徑；未設定時讀取 `~/.claude.json` 的 `azure-devops`
- `PRREVIEW_CODEX`：Codex 執行檔完整路徑

daemon 會分別檢查兩個 CLI；其中一個不存在不會阻止另一個使用。

### 載入插件

1. 開啟 `chrome://extensions`。
2. 開啟「開發人員模式」。
3. 選擇「載入未封裝項目」，指定 `prreview/extension`。
4. 開啟 Azure DevOps PR 頁面，在右側面板的「設定」區貼上 daemon 印出的 token，按「儲存設定」。可按「測試連線」確認 token 有效。

插件支援 `https://dev.azure.com/...` 與 `https://{organization}.visualstudio.com/...` 兩種 Azure DevOps Cloud 網址。自架 Server 與其他網域不支援。

## 使用

開啟 PR 詳細頁，第一次使用先在右側面板的「設定」區輸入 daemon URL 與 token，按「儲存設定」；之後選擇 Claude 或 Codex，按「開始審核」。進度會即時顯示，完成後列出依嚴重度排序的 findings。設定與 Agent 選擇會保存到瀏覽器本機儲存空間。

Claude 執行會使用 `--restricted` 與 `--strict-mcp-config`，從 MCP 設定中只注入 `azure-devops` server；Codex 執行會使用 `--sandbox read-only`、`--ignore-user-config` 與 `--output-schema`，只重新注入 `azure-devops` MCP 的五個唯讀工具。兩個 provider 都只允許這五個唯讀工具。可先執行下列指令確認 MCP：

```text
codex mcp get azure-devops --json
```

## severity

| 等級 | 意義 |
|------|------|
| `blocker` | 會造成資料錯誤、安全漏洞或服務中斷，不修不能合併 |
| `major` | 明確的缺陷，但影響範圍有限 |
| `minor` | 值得改，但不修也不會出事 |
| `nit` | 吹毛求疵，作者可自行判斷 |

## 疑難排解

| 症狀 | 處理 |
|------|------|
| 面板沒出現 | 確認網址是 PR 詳細頁，且使用 `dev.azure.com` 或 `*.visualstudio.com` |
| daemon 未連線 | 確認 `npm start` 正在執行，且插件使用同一個埠號 |
| token 無效 | 重新複製 daemon 啟動時印出的 token，在側邊欄「設定」區重新儲存；不要把 token 放進 URL |
| Claude 找不到 azure-devops MCP | 確認 `claude mcp list` 顯示已連線；設定 `PRREVIEW_CLAUDE_MCP_CONFIG` 指向含有 `mcpServers.azure-devops` 的 JSON 設定檔 |
| 找不到 Claude 或 Codex | 設定對應的 `PRREVIEW_CLAUDE` 或 `PRREVIEW_CODEX` 完整路徑 |
| Codex 找不到 MCP | 執行 `codex mcp get azure-devops --json`，確認 server 已啟用 |
| 結果顯示為純文字 | Agent 沒有符合 JSON 格式，原始文字仍會保留在面板，可重跑審核 |

## 安全性

- daemon 僅監聽 `127.0.0.1`。
- `/review`、`/auth` 與 SSE 事件都必須帶 token，驗證在解析 body 或啟動 job 前完成。
- CORS 僅允許 Azure DevOps Cloud 網域。
- Claude 使用隔離的暫存 MCP 設定，只載入 Azure DevOps server，並僅開放五個唯讀工具。
- Codex 使用 read-only sandbox 與隔離設定；file change 事件會中止審核。
- token 等同於在本機啟動 Agent 的權限，請勿外流。

## 開發與測試

```text
cd prreview/daemon
node --test

cd ../extension
node --test
```

設計文件位於 `docs/superpowers/specs/`，實作計畫位於 `docs/superpowers/plans/`。
