# Phase 2: DataSources UI 設計文件

## 概述

Phase 2 實現了 DataSources 管理 UI，讓使用者透過 Web 介面管理資料源（YouTube 頻道、RSS Feed），取代純設定檔操作。

## 架構

```
React UI (renderer/) → fetch('/api/...') → 內嵌 HTTP Server (src/api-server.js) → AppEngine
```

### 設計決策：HTTP Server 取代 Electron IPC

選擇內嵌 HTTP server 而非 Electron IPC 的原因：
- UI 為標準 web app，任何瀏覽器皆可開啟
- 不需要 preload.js、contextBridge、BrowserWindow 等 Electron 機制
- REST API 可直接被外部工具呼叫
- 未來將 UI 搬到獨立 web server 零成本

## 模組說明

### `src/api-server.js` — HTTP Server

使用 Node.js 內建 `http` 模組，無 Express 依賴。

- `start(port)` / `stop()` — Promise-based lifecycle
- 綁定 `127.0.0.1`（僅本機存取）
- `/api/*` 路徑走 route dispatcher
- 其他路徑 serve `dist-renderer/` 靜態檔（含 SPA fallback → index.html）
- 預設 port: `3579`，可透過 `config.app.apiPort` 設定
- `apiPort: null` → 不啟動 server（用於測試）
- `apiPort: 0` → OS 分配隨機 port

### `src/api-routes.js` — REST API Routes

| Method | Pattern | 說明 |
|--------|---------|------|
| GET | `/api/datasources` | 列出全部資料源 |
| POST | `/api/datasources/validate` | URL 驗證 |
| POST | `/api/datasources` | 新增資料源 + 啟動排程 |
| GET | `/api/datasources/:id/stats` | 取得統計資料 |
| POST | `/api/datasources/:id/check` | 立即檢查 |
| PATCH | `/api/datasources/:id/toggle` | 啟用/停用 |
| PUT | `/api/datasources/:id` | 更新資料源 |
| DELETE | `/api/datasources/:id` | 刪除資料源 |
| GET | `/api/engine/status` | 引擎狀態 |

Engine 未啟動時，需要 engine running 的端點回傳 503。
`GET /api/datasources` 和 `GET /api/engine/status` 在任何狀態下皆可用。

### `src/app-engine.js` — ApiServer 整合

- Scheduler 啟動後啟動 ApiServer（步驟 12）
- `stop()` 時在關 DB 前停 ApiServer
- `_safeCleanup()` 加入 ApiServer 清理
- `getApiPort()` getter
- Emit `'serverReady'` event（帶 port），通知 Electron

### `renderer/src/ipc.js` — API 呼叫層

唯一的後端溝通層，使用 `fetch()` 呼叫 REST API。
使用相對路徑（production 時由同一 server serve，不需 CORS）。

### `renderer/vite.config.js` — Dev Proxy

開發模式下 `/api/*` 轉發到 `http://127.0.0.1:3579`，確保 hot-reload 正常運作。

### Electron 整合

#### `electron/main.js`

- 監聽 `serverReady` event，不再使用 IPC/WindowManager
- **Single-instance lock**：啟動時呼叫 `app.requestSingleInstanceLock()`；若 lock 取得失敗（已有其他 instance 在執行）則立即 `app.quit()`
- **`second-instance` event**：當第二個 instance 嘗試啟動時觸發；若 engine 已就緒（`getApiPort()` 有值），呼叫 `shell.openExternal()` 開啟瀏覽器

#### `electron/tray.js`

- Settings 改為 `shell.openExternal()` 開瀏覽器，port 未就緒前 disabled
- 右鍵選單包含 `Status: {state}` 唯讀項目，顯示引擎目前狀態（e.g. `Status: running`）
- `destroy()` 方法：銷毀 tray icon 並清除 `this._tray` 參照

## React UI 元件

```
renderer/src/
  ├── main.jsx                   — React mount point（ReactDOM.createRoot）
  ├── App.jsx                    — Router + Layout
  ├── pages/
  │   └── DataSourcesPage.jsx    — 資料源管理頁
  ├── components/
  │   ├── DataSourceForm.jsx     — 新增/編輯表單
  │   ├── DataSourceList.jsx     — 資料源列表
  │   ├── ValidationStatus.jsx   — URL 驗證結果顯示（驗證中/成功/失敗）
  │   └── ConfirmDialog.jsx      — 可重用確認對話框（刪除資料源、強制儲存等情境）
  ├── hooks/
  │   └── useDataSources.js      — 資料源狀態管理 hook
  └── ipc.js                     — API 呼叫層（fetch）
```

## 設定

`config/settings.json` 的 `app` 區塊：

```json
{
  "app": {
    "apiPort": 3579
  }
}
```

| 值 | 行為 |
|----|------|
| `3579`（或任意數字） | 使用指定 port 啟動 server |
| `0` | OS 隨機分配 port 並啟動 server |
| `null` | 不啟動 HTTP server（用於測試） |
| 未設定（key 不存在，`undefined`） | 預設使用 `3579`，仍啟動 server |
