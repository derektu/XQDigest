# XQDigest - 技術規格文件 v2.2

> XQDigest: 財經資訊自動摘要工具
> 本文件記錄 v0.3.x（Phase 0~7 全部完成）的實際技術規格，供維護與擴展參考。
> 注意：v1.2 規格文件為開發前的設計藍圖，本文件反映最終實作。

---

## 📋 專案概述

**產品名稱**: XQDigest
**產品定位**: 財經資訊自動摘要工具
**目標平台**: macOS、Windows 桌面應用程式
**目前版本**: v0.3.3

### 產品簡介

XQDigest 是一款專為財經專業人士設計的桌面應用程式。透過自動監控多個資料來源（YouTube 頻道、RSS Feed），結合 AI 大型語言模型，為使用者產生高品質的內容摘要。所有資料儲存在本地，透過內嵌 Web 介面（瀏覽器開啟）操作，應用程式以系統托盤（Tray）常駐背景運行。

### 核心價值

- **自動化**: 定時監控資料源，無需手動檢查
- **AI 智能**: 運用 LLM 產生精煉摘要
- **知識累積**: 建立個人化財經知識庫
- **本地優先**: 資料儲存在本地，隱私安全
- **整合就緒**: REST API 供外部程式整合

### 開發歷程

| Phase | 內容 | 狀態 |
|-------|------|------|
| Phase 0 | 純 CLI POC：核心抓取 + 摘要流程驗證 | ✅ 完成 |
| Phase 1 | Electron 框架整合（AppEngine + Tray） | ✅ 完成 |
| Phase 2 | DataSources UI + 內嵌 HTTP Server | ✅ 完成 |
| Phase 3 | LLM Settings UI + 測試連線 | ✅ 完成 |
| Phase 4 | Feed 頁面（內容清單 + 已讀管理） | ✅ 完成 |
| Phase 5 | 下載與摘要分離（兩階段處理架構） | ✅ 完成 |
| Phase 6 | 打包、版號顯示、Tray 自動更新檢查 | ✅ 完成 |
| Phase 7 | OpenAI OAuth 登入（PKCE + Streaming） | ✅ 完成 |

---

## ✅ 已確認的技術決策

### 1. 開發技術棧

| 層次 | 技術 | 說明 |
|------|------|------|
| 桌面框架 | **Electron** | 跨平台，完全獨立運行 |
| 後端語言 | **Node.js (CommonJS)** | Electron main process 內執行 |
| HTTP Server | **Node.js 內建 `http` 模組** | 無第三方框架 |
| 資料庫 | **better-sqlite3** | 同步 API，效能佳 |
| 前端框架 | **React + Vite** | 開發時獨立 server，生產時打包靜態檔 |
| 排程 | **setInterval** | 無第三方排程套件 |
| YouTube 字幕 | **yt-dlp**（bundled） | 隨 app 打包，不依賴系統安裝 |
| RSS 解析 | **rss-parser** | npm 套件 |
| LLM SDK | **openai**、原生 fetch（Gemini） | OpenAI SDK + fetch |

### 2. 介面模式

**Tray-only（無主視窗）**：應用程式以系統托盤常駐，不開啟 Electron BrowserWindow。使用者點擊托盤 → 在預設瀏覽器開啟 `http://localhost:{port}`。

### 3. API Key 儲存

**SQLite `app_settings` 表**（非 keytar/系統 Keychain）：
- LLM 設定（含 API Key）以 JSON 格式存於 `app_settings` key=`'llm'`
- UI 顯示時遮罩（`****xxxx`），後端不輸出明文至日誌

### 4. 安裝需求

- **macOS**: `.dmg` + `.app` bundle（含 yt-dlp 二進位）
- **Windows**: `.exe` NSIS 安裝程式（含 yt-dlp.exe）
- **自動更新**: electron-updater 檢查 GitHub Releases
- **零系統依賴**: yt-dlp 隨 app bundled

---

## 🏗️ 後端架構設計

### HTTP Server

使用 **Node.js 內建 `http` 模組**（`src/api-server.js`）：
- 監聽 `127.0.0.1:{apiPort}`（只接受 localhost）
- 同時提供 REST API (`/api/...`) 和前端靜態檔（`/`）
- 預設 port：**3579**（可透過 `settings.json` 的 `app.apiPort` 調整）

### 資料儲存

**混合儲存：SQLite 元數據 + Markdown 完整內容**

- SQLite 路徑：`{dataPath}/database/content.db`
- Markdown 路徑：`{dataPath}/content/{source_type}/{YYYY-MM-DD}_{item_id}.md`

#### 完整 DB Schema

```sql
-- 內容項目（主要資料表）
CREATE TABLE IF NOT EXISTS content_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type       TEXT NOT NULL,          -- 'youtube' | 'rss'
  source_id         TEXT NOT NULL,          -- 對應 data_sources.id
  item_id           TEXT UNIQUE NOT NULL,   -- YouTube video_id 或 RSS 文章 ID
  title             TEXT,
  url               TEXT,
  author            TEXT,                   -- 頻道名稱或作者
  published_date    DATETIME,
  fetched_date      DATETIME NOT NULL,
  markdown_file_path TEXT NOT NULL,         -- 相對路徑
  raw_content       TEXT,                   -- 下載的原始文字內容（字幕/文章）
  summary           TEXT,                   -- LLM 產生的摘要
  tags              TEXT,                   -- JSON array（保留欄位）
  status            TEXT DEFAULT 'new',     -- 'new' | 'fetched' | 'summarized' | 'processed'
  is_read           INTEGER DEFAULT 0,      -- 0=未讀, 1=已讀
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_content_items_source_id     ON content_items(source_id);
CREATE INDEX IF NOT EXISTS idx_content_items_status        ON content_items(status);
CREATE INDEX IF NOT EXISTS idx_content_items_published_date ON content_items(published_date);
CREATE INDEX IF NOT EXISTS idx_content_items_source_type   ON content_items(source_type);

-- 資料源
CREATE TABLE IF NOT EXISTS data_sources (
  id              TEXT PRIMARY KEY,         -- UUID
  source_type     TEXT NOT NULL,            -- 'youtube' | 'rss'
  source_name     TEXT NOT NULL,            -- 使用者自訂名稱
  source_url      TEXT NOT NULL,            -- 頻道 URL 或 RSS URL
  check_interval  INTEGER DEFAULT 3600,     -- 檢查間隔（秒）
  max_items       INTEGER DEFAULT 10,       -- 每次最多抓取筆數
  lookback_days   INTEGER DEFAULT 7,        -- 往回查看天數
  prompt          TEXT DEFAULT '',          -- 自訂摘要 prompt（優先於全域設定）
  is_active       INTEGER DEFAULT 1,
  last_check      DATETIME,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 失敗項目記錄
CREATE TABLE IF NOT EXISTS failed_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type   TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  item_id       TEXT UNIQUE NOT NULL,
  title         TEXT,
  url           TEXT,
  error_message TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_failed_items_item_id ON failed_items(item_id);

-- 應用程式設定（key-value，value 為 JSON 字串）
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,                 -- JSON 字串
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 注意：llm_configs 表仍存在於 schema 中，但 LLM 設定已改由 app_settings key='llm' 管理
```

**`status` 欄位說明：**

| status | 含義 |
|--------|------|
| `new` | 已發現但尚未下載 |
| `fetched` | 已下載原始內容，等待 LLM 摘要 |
| `summarized` | LLM 摘要完成（正式狀態） |
| `processed` | 舊版相容（等同 summarized） |

**LLM 設定存取範例（`app_settings`）：**

```javascript
// 讀取
const llmSettings = db.getAppSetting('llm');
// { provider, apiKey, model, baseUrl, maxTokens, temperature, summarizationPrompt, ... }

// 寫入
db.setAppSetting('llm', { provider: 'openai', apiKey: 'sk-...', model: 'gpt-4o-mini' });
```

### Markdown 檔案格式

```markdown
---
title: 影片標題或文章標題
source: YouTube / RSS
item_id: abc123
author: 頻道名稱或作者
published: 2024-02-11T10:30:00Z
url: https://youtube.com/watch?v=abc123
fetched: 2024-02-11T12:00:00Z
---

# [標題]

## 原始內容

### YouTube 字幕
[完整字幕文字...]

### RSS 文章內容
[完整文章內容...]

## AI 摘要

[LLM 產生的純文字摘要...]
```

### 兩階段資料處理流程

Phase 5 引入的核心架構，下載與摘要完全分離：

```
Stage 1 - DownloadQueue（並發，最多 concurrentLimit 個同時進行）:
  Scheduler 觸發
    → YouTube/RSS Fetcher 抓取原始內容
    → Storage.saveContent()：寫 Markdown 檔案 + 寫 DB（status='fetched', raw_content 存 DB）
    → 加入 LLMQueue

Stage 2 - LLMQueue（單執行緒，sliding window rate limiting）:
  從 DB 讀取 raw_content
    → LLMService.summarize()：呼叫 LLM API
    → 寫回 DB（status='summarized', summary）
    → 更新 Markdown 檔案的 AI 摘要區塊

重啟恢復：
  AppEngine.start() → 掃描 status='fetched' 的 items
    → 重新加入 LLMQueue（確保重啟後不遺失待摘要項目）
```

**設計原則：**
- DownloadQueue：並發下載，控制頻寬
- LLMQueue：單執行緒，控制 API rate limit（支援 requestsPerMinute 設定）
- 兩個 Queue 完全解耦，下載失敗不影響已下載的摘要工作

---

## 🧩 模組架構

### AppEngine（`src/app-engine.js`）

應用核心引擎，繼承 `EventEmitter`，管理所有模組的生命週期。

**狀態機：**
```
stopped → starting → running ↔ paused → stopping → stopped
```

| 狀態 | 說明 |
|------|------|
| `stopped` | 初始/停止狀態，所有模組已釋放 |
| `starting` | 正在初始化所有模組 |
| `running` | 正常運行，排程器運作中 |
| `paused` | 排程器暫停，但 DB/API 仍可用 |
| `stopping` | 正在關閉，等待 Queue drain |

**初始化順序（`start()`）：**
1. ConfigManager — 讀取 settings.json
2. Logger — 初始化日誌系統
3. DB — 開啟 SQLite
4. DataSourceManager — 讀取 data_sources 表
5. Storage — 初始化 Markdown + DB 雙寫
6. DownloadQueue — 並發下載佇列
7. YouTubeFetcher / RSSFetcher
8. LLMLogger — LLM 呼叫記錄
9. LLMService — LLM 客戶端（從 DB 讀取設定）
9.5. OAuthClient — 注入 DB storage（key=`openai_oauth_tokens`），解析 openBrowser
9.6. 若 llmSettings.provider === 'openai-oauth' → 以 oauthClient 重建 LLMService
10. LLMQueue — 摘要佇列
11. Scheduler — 定時排程器
12. 設定熱重載（config hot-reload）
13. Scheduler.start()
14. `_resumePendingSummaries()` — 恢復未完成的摘要
15. ApiServer — HTTP server 啟動

**關鍵事件：**
- `stateChange(newState, oldState)`
- `serverReady(port)`
- `configReloaded`
- `error(err)`

---

### Scheduler（`src/scheduler.js`）

定時掃描所有啟用的資料源，依各自 `check_interval` 決定是否觸發檢查。

- 使用 `setInterval`（非 node-cron）
- 每個資料源維護獨立的 `nextCheckTime`
- 支援 `checkSource(id)` 手動觸發（供 API 呼叫）
- 支援動態新增/移除資料源（`addSource`/`removeSource`）

---

### DownloadQueue（`src/queue.js`）

並發下載佇列，控制同時下載數量與重試邏輯。

| 設定 | 預設值 | 說明 |
|------|--------|------|
| `concurrentLimit` | 3 | 最大同時下載數 |
| `retryAttempts` | 3 | 重試次數 |
| `retryDelay` | 1000ms | 重試間隔（指數退避） |
| `timeoutMs` | 30000ms | 單任務 timeout |

**事件：** `taskAdded`、`taskStarted`、`taskCompleted`、`taskRetry`、`taskFailed`

---

### LLMQueue（`src/llm-queue.js`）

摘要佇列，單執行緒處理，支援 sliding window rate limiting。

| 設定 | 預設值 | 說明 |
|------|--------|------|
| `retryAttempts` | 3 | LLM 呼叫重試次數 |
| `retryDelay` | 5000ms | 重試間隔 |
| `requestsPerMinute` | 0 | 0 = 無限制 |

**事件：** `taskAdded`、`taskStarted`、`taskCompleted`、`taskFailed`

---

### LLMService（`src/llm/index.js`）

LLM 客戶端，支援三種 provider：

| Provider | 說明 |
|----------|------|
| `openai` | OpenAI API（使用 openai npm SDK） |
| `gemini` | Google Gemini API（使用原生 fetch） |
| `openai-compatible` | 相容 OpenAI API 格式的第三方端點 |
| `openai-oauth` | OpenAI Responses API，OAuth 帳號授權（`gpt-5.2`，SSE streaming，usage=null） |

**摘要 Prompt 優先順序：**
1. 資料源自訂 `prompt`（`data_sources.prompt`）
2. UI 設定的 `summarizationPrompt`（`app_settings['llm'].summarizationPrompt`）
3. `settings.json` 的 `llm.summarizationPrompt`
4. 程式內建預設（繁中，plain text 輸出格式）

**注意：** 摘要輸出格式為**純文字**（非 JSON），格式由 prompt 中的明確指令控制。

---

### OAuthClient（`src/llm/openai-oauth-client.js`）

PKCE OAuth 2.0 client，封裝 OpenAI 帳號登入流程。

| 方法 | 說明 |
|------|------|
| `login()` | 啟動 PKCE 流程（port 1455 callback server，60 秒 timeout） |
| `logout()` | 清除 token |
| `getValidToken()` | 自動 refresh（5 分鐘緩衝），回傳有效 access token |
| `chatCompletion(messages, options)` | 呼叫 Responses API（SSE），回傳 `{text, usage: null}` |
| `getStatus()` | 同步回傳 `{loggedIn, accountId, expires}` |

Token 存於 `app_settings['openai_oauth_tokens']`。

---

### OpenAIOAuthProvider（`src/llm/openai-oauth.js`）

繼承 `BaseLLMProvider`，委派 `OAuthClient.chatCompletion()`。model 固定 `gpt-5.2`，usage 固定 `null`（Responses API 不回傳 token 計數）。

---

### DataSourceManager（`src/datasource-manager.js`）

SQLite `data_sources` 表的 CRUD 封裝。

**主要方法：**
- `getAll()` — 取得所有資料源
- `getEnabled()` — 取得啟用中的資料源
- `getById(id)` — 取得單一資料源
- `add(data)` — 新增資料源
- `update(id, data)` — 更新資料源
- `remove(id)` — 刪除資料源
- `toggle(id, enabled)` — 啟用/停用
- `getStats(id)` — 取得統計（內容數等）

---

### Storage（`src/storage.js`）

Markdown 檔案 + SQLite 雙寫管理。

- `saveContent(item)` — 寫 Markdown 檔案 + 寫 DB（status='fetched'）
- `updateSummary(itemId, summary)` — 更新 Markdown 的 AI 摘要 + 更新 DB（status='summarized'）

---

### ConfigManager（`src/config.js`）

讀取並監控 `config/settings.json`，支援熱重載（chokidar）。

- 設定的實際儲存路徑由環境或建構方式決定
- 若 `settings.json` 不存在，使用 `src/defaults.js` 的預設值

---

### Logger（`src/logger.js`）

Singleton 日誌系統，寫入 `logs/app.log`。

- 支援 `debug`、`info`、`warn`、`error` 四個等級
- `Logger.close()` 回傳 Promise（非同步 flush，測試時需 `await`）

---

### LLMLogger（`src/llm-logger.js`）

LLM 呼叫專用記錄，寫入 `logs/llm.log`。每次 LLM 呼叫記錄：itemId、provider、model、promptTokens、completionTokens、durationMs、status、error。

---

### YouTubeFetcher（`src/fetchers/youtube.js`）

透過 **yt-dlp**（bundled）下載 YouTube 字幕，採**兩步驟流程**以降低 HTTP 請求次數（修正 429 Too Many Requests 問題）：

**Step 1 — 查詢可用語言** (`_getAvailableLangs(videoId)`)：
- 執行 `yt-dlp --dump-json --skip-download`，取得影片完整 metadata
- 回傳 `{ manual: string[], auto: string[] }` 兩組可用語言清單

**Step 2 — 選取最佳語言** (`_pickBestLang(manualLangs, autoLangs)`)：
- 優先從 manual 字幕依序比對優先序：`zh-TW > zh-Hant > zh-Hans > zh-CN > en`
- 若 manual 無符合項，fallback 至原始英文 ASR（`en-orig` → `en`），避免使用機器翻譯的自動字幕
- 回傳單一語言代碼（或 `null` 表示無字幕可用）

**Step 3 — 下載單一字幕** (`_runYtDlp(videoId, tmpDir, subLang)`)：
- 以 `--sub-lang {lang}` 只下載選定語言，HTTP 請求從舊版 5-10 個降至約 2 個
- 解析 VTT 格式 (`_parseVTT()`)，去除重複行與 HTML 標籤（`<c>`, `<font>` 等）
- Packaged app 中使用 `process.resourcesPath/bin/yt-dlp`，開發模式使用系統 PATH

---

### RSSFetcher（`src/fetchers/rss.js`）

使用 `rss-parser` 解析 RSS/Atom feed，取得最新文章列表與內容。

---

## 🌐 REST API 端點

API server 統一前綴 `/api`，所有回應為 JSON。

### 版本與狀態

| Method | 路徑 | 說明 |
|--------|------|------|
| GET | `/api/version` | 取得 app 版本號（含 `isPackaged` 欄位，由 `electron.app.isPackaged` 提供；CLI 模式 fallback `false`） |
| GET | `/api/engine/status` | 取得 AppEngine 狀態（state、dataSources 數、llmConfigured） |

### 內容管理

| Method | 路徑 | 說明 |
|--------|------|------|
| GET | `/api/content` | 取得內容列表（支援 `sourceId`、`limit`、`offset` 參數，最多 100 筆） |
| GET | `/api/content/unread-counts` | 取得未讀計數（總計 + 各資料源分項） |
| GET | `/api/content/:id` | 取得單一內容詳情（含 raw_content、summary） |
| PATCH | `/api/content/:id/read` | 標記已讀/未讀（body: `{ is_read: 0|1 }`） |

### 資料源管理

| Method | 路徑 | 說明 |
|--------|------|------|
| GET | `/api/datasources` | 取得所有資料源 |
| POST | `/api/datasources` | 新增資料源 |
| PUT | `/api/datasources/:id` | 更新資料源 |
| DELETE | `/api/datasources/:id` | 刪除資料源 |
| PATCH | `/api/datasources/:id/toggle` | 啟用/停用資料源（body: `{ enabled: true|false }`） |
| POST | `/api/datasources/:id/check` | 手動觸發立即檢查 |
| GET | `/api/datasources/:id/stats` | 取得資料源統計（內容數等） |
| POST | `/api/datasources/validate` | 驗證 URL 格式並測試連線（body: `{ type, url }`） |

### LLM 設定

| Method | 路徑 | 說明 |
|--------|------|------|
| GET | `/api/settings/llm` | 取得 LLM 設定（apiKey 以 `****xxxx` 遮罩） |
| PUT | `/api/settings/llm` | 更新 LLM 設定（若 apiKey 為遮罩格式，保留現有值） |
| POST | `/api/settings/llm/test` | 測試 LLM 連線並列出可用 models（`openai-oauth` 時不需 apiKey，驗證 token 狀態） |
| GET | `/api/settings/llm/oauth/status` | 取得 OAuth 登入狀態（`{loggedIn, accountId, expires}`） |
| POST | `/api/settings/llm/oauth/login` | 啟動 OAuth login（背景執行，UI polling status） |
| DELETE | `/api/settings/llm/oauth/logout` | 登出並清除 token |

**共 20 個 endpoints。**

**Engine 狀態限制：** 大多數端點在 engine 非 `running` 狀態時回傳 HTTP 503。例外：`/api/version`、`/api/engine/status`、`/api/content/unread-counts`、`/api/content`、`/api/datasources`（這些在 engine 未啟動時回傳空資料而非 503）。

---

## 🎨 前端介面設計

### 技術選型

- **框架**: React + Vite
- **語言**: JavaScript（JSX）
- **路由**: React Router
- **目錄**: `renderer/src/`
- **打包**: Vite 建置至 `renderer/dist/`，由 ApiServer 作為靜態檔服務

### 介面模式：Tray-only

- **無 Electron BrowserWindow 主視窗**
- 使用者透過系統 Tray 點擊，在預設**瀏覽器**開啟 `http://localhost:{port}`
- macOS：Menu Bar 圖示；Windows：System Tray 圖示

### 托盤右鍵選單

```
├─ 開啟 XQDigest
├─ 立即檢查更新
├─ ────────────
└─ 結束程式
```

### 三頁結構

#### 1. Feed 頁（`/`）

顯示所有已摘要的內容：
- 卡片式清單（標題、來源、發布時間、摘要預覽）
- 篩選：依資料源（`sourceId`）
- 分頁：limit/offset
- 未讀/已讀管理（點擊後標記為已讀）
- 未讀徽章（頁面標籤及各資料源計數）

#### 2. DataSources 頁（`/datasources`）

管理資料源：
- 資料源列表（類型、名稱、URL、最後檢查時間、狀態）
- 新增/編輯表單（含 URL 驗證連線測試）
- 啟用/停用 toggle
- 刪除
- 「立即檢查」按鈕

#### 3. Settings 頁（`/settings`）

管理 LLM 設定：
- Provider 選擇（OpenAI OAuth / OpenAI API Key / Gemini / OpenAI-compatible）；OAuth 模式下顯示登入狀態區塊，隱藏 API Key 欄位，model 固定 gpt-5.2
- API Key 輸入（顯示遮罩；OAuth 模式隱藏）
- Base URL（openai-compatible 時顯示）
- Model 選擇（OAuth 模式固定顯示 gpt-5.2，不可編輯）
- Max Tokens、Temperature
- 自訂摘要 Prompt（可覆寫全域預設）
- 「測試連線」按鈕

---

## ⚙️ 設定管理

### 設定檔位置

`config/settings.json`（git-ignored，參考 `config/settings.json.example`）

### 設定格式

```json
{
  "app": {
    "logLevel": "info",
    "dataPath": "./data",
    "apiPort": 3579
  },
  "download": {
    "concurrentLimit": 3,
    "retryAttempts": 3,
    "retryDelay": 1000,
    "timeoutMs": 30000
  },
  "llm": {
    "retryAttempts": 3,
    "retryDelay": 5000,
    "requestsPerMinute": 0,
    "summarizationPrompt": ""
  }
}
```

### 設定說明

#### `app` 區塊

| 欄位 | 預設值 | 說明 |
|------|--------|------|
| `logLevel` | `"info"` | `debug`\|`info`\|`warn`\|`error` |
| `dataPath` | `"./data"` | 資料目錄（SQLite + Markdown） |
| `apiPort` | `3579` | HTTP server port |

#### `download` 區塊

| 欄位 | 預設值 | 說明 |
|------|--------|------|
| `concurrentLimit` | `3` | 最大同時下載數 |
| `retryAttempts` | `3` | 下載重試次數 |
| `retryDelay` | `1000` | 重試間隔（ms） |
| `timeoutMs` | `30000` | 下載 timeout（ms） |

#### `llm` 區塊

| 欄位 | 預設值 | 說明 |
|------|--------|------|
| `retryAttempts` | `3` | LLM 呼叫重試次數 |
| `retryDelay` | `5000` | LLM 重試間隔（ms） |
| `requestsPerMinute` | `0` | Rate limit（0 = 無限制） |
| `summarizationPrompt` | `""` | 全域摘要 prompt（空白 = 程式內建預設） |

**注意：** LLM provider、API Key、model 等設定由 Settings UI 管理，存於 SQLite `app_settings`，**不在** `settings.json` 中。資料源設定亦由 DataSources UI 管理，存於 SQLite `data_sources` 表。

### 設定熱重載

`settings.json` 修改後會自動 reload（chokidar 監控），重載後更新：
- Logger 等級
- DownloadQueue 並發限制

---

## 📦 打包與部署

### 打包工具

**electron-builder**（`electron-builder.yml`）

### 平台設定

| 平台 | 格式 | 說明 |
|------|------|------|
| macOS | `.dmg` + `.app` + `.zip` | zip 供 auto-updater 使用 |
| Windows | `.exe`（NSIS） | 含安裝精靈；`artifactName` 固定為 `${productName}-Setup-${version}.${ext}`，確保與 `latest.yml` 記錄的 URL 一致 |

### yt-dlp Bundled

- 位置：`extraResources/bin/yt-dlp`（macOS/Linux）、`extraResources/bin/yt-dlp.exe`（Windows）
- AppEngine 啟動時透過 `process.resourcesPath` 定位
- 開發模式下 fallback 至系統 PATH 的 `yt-dlp`

### 自動更新

使用 `electron-updater`，僅在打包模式（`app.isPackaged`）下啟用。

**`updaterState` 狀態機（`electron/main.js`，in-memory）：**

```
idle → checking → (update available?) → downloading → downloaded → (restart) → idle
                → (no update / up-to-date) → idle
```

| 狀態 | 說明 |
|------|------|
| `idle` | 初始狀態，或確認無更新後 |
| `checking` | 正在查詢 GitHub Releases |
| `downloading` | 使用者確認下載，背景下載中 |
| `downloaded` | 下載完成，等待使用者確認重啟 |

**行為說明：**
- `autoDownload = false`：不自動下載，發現新版本時彈窗詢問使用者
- 使用者點「檢查更新」時依 `updaterState.status` 給予對應提示（防止重複觸發）
- 下載確認後立即顯示「背景下載中」提示，消除等待時的不確定感
- 下載完成通知顯示版本號（`v${pendingVersion}`）
- 啟動後 10 秒自動觸發一次更新檢查
- 更新來源：GitHub Releases

### 前端建置

```bash
npm run build:renderer   # 建置 React 至 renderer/dist/
npm run build            # 建置並打包 Electron app
```

---

## 🧪 測試規範

### 測試框架

- 使用 Node.js 內建 **`node:test`** 模組
- 斷言使用 **`node:assert/strict`**
- 不依賴外部測試框架

### 測試執行

```bash
npm test                               # 執行所有測試（自動掃描 tests/test-*.js）
node --test tests/test-config.js       # 執行單一模組測試
```

### 修改程式碼的 Checklist

1. 修改模組 → 更新對應的 `tests/test-{模組}.js`
2. 新增模組 → 建立對應的測試檔案
3. 修改設定檔格式 → 更新 `tests/test-config.js`
4. 修改資料庫 schema → 更新 `tests/test-db.js` 和 `tests/test-storage.js`

### 測試慣例

| 項目 | 規範 |
|------|------|
| 命名 | 中文描述行為，格式 `{方法名}() {應/不應}{做什麼}` |
| 暫存目錄 | `tests/` 下，使用 `_tmp_` 前綴，在 before/after 中建立與清除 |
| Mock | 簡單物件 mock（依賴注入），不需 mock 框架 |
| 網路測試 | try/catch 包裹，網路不可用時 graceful 跳過 |

---

## 📘 產品資訊

### 版本

**v0.3.x**（Phase 0~7 全部完成）

### 品牌定位

- **主品牌**: XQ（財經平台）
- **產品線**: XQDigest（資訊摘要工具）
- **Slogan**: 財經資訊自動摘要工具 / Your Financial Knowledge Feeder

### 支援平台

- macOS（Apple Silicon + Intel）
- Windows 10/11

### 目標使用者

- 財經專業人士
- 投資研究分析師
- 主動投資人
- 財經內容創作者

---

**最後更新**: 2026-02-24
**規格版本**: 2.2
**產品名稱**: XQDigest - 財經資訊自動摘要工具
**狀態**: ✅ Phase 0~7 全部完成
