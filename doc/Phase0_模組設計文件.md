# XQDigest Phase 0 — 模組設計文件

> 本文件記錄 Phase 0 (POC) 階段的模組架構、資料流程、各模組職責與公開介面。
> 適用版本：v0.2.0

---

## 1. 整體架構

### 1.1 架構概觀

```
                        ┌─────────────────┐
                        │   index.js      │  應用程式入口
                        │   (啟動/關閉)    │
                        └────────┬────────┘
                                 │ 初始化所有模組
            ┌────────────────────┼────────────────────┐
            │                    │                    │
   ┌────────▼────────┐  ┌───────▼───────┐  ┌────────▼────────┐
   │  ConfigManager   │  │    Logger     │  │       DB        │
   │  (設定管理)       │  │ (Singleton)   │  │   (資料庫)      │
   └────────┬────────┘  └───────────────┘  └────────┬────────┘
            │                                        │
   ┌────────▼────────────────────────────────────────▼────────┐
   │                      Scheduler                           │
   │                    (排程與協調)                            │
   └────┬──────────┬──────────┬──────────┬───────────────────┘
        │          │          │          │
  ┌─────▼─────┐ ┌─▼────────┐ │   ┌──────▼──────┐
  │ YouTube   │ │   RSS    │ │   │  LLMService │
  │ Fetcher   │ │ Fetcher  │ │   │  (摘要生成)  │
  └───────────┘ └──────────┘ │   └──────┬──────┘
                        ┌────▼────────┐  │
                        │   Storage   │  ├── BaseLLMProvider
                        │ (Markdown   │  ├── OpenAIProvider
                        │  + SQLite)  │  └── GeminiProvider
                        └─────────────┘
                              │
                    ┌─────────▼──────────┐
                    │  DownloadQueue     │
                    │ (並發控制 + 重試)   │
                    └────────────────────┘
```

### 1.2 模組清單

| 模組 | 檔案路徑 | 職責 |
|------|----------|------|
| **index.js** | `src/index.js` | 應用程式入口，初始化並串接所有模組 |
| **ConfigManager** | `src/config.js` | 讀取/監聽 JSON 設定檔 |
| **Logger** | `src/logger.js` | Singleton，Console + 檔案日誌，支援 rotation |
| **DB** | `src/database/db.js` | SQLite 資料庫操作 |
| **Storage** | `src/storage.js` | Markdown 檔案 + SQLite 雙寫管理 |
| **YouTubeFetcher** | `src/fetchers/youtube.js` | YouTube 頻道掃描 + yt-dlp 字幕下載 |
| **RSSFetcher** | `src/fetchers/rss.js` | RSS/Atom Feed 解析 |
| **LLMService** | `src/llm/index.js` | LLM 統一入口（分派至各 provider） |
| **BaseLLMProvider** | `src/llm/base.js` | Provider 抽象基底類別 |
| **OpenAIProvider** | `src/llm/openai.js` | OpenAI / OpenAI-compatible 呼叫 |
| **GeminiProvider** | `src/llm/gemini.js` | Google Gemini 呼叫 |
| **DownloadQueue** | `src/queue.js` | 任務佇列，並發控制與指數退避重試 |
| **Scheduler** | `src/scheduler.js` | 定時排程 + 處理 pipeline 協調 |

### 1.3 模組依賴關係

```
index.js
 ├── ConfigManager
 ├── Logger               ← Singleton，透過 Logger.init() 初始化
 ├── DB
 ├── Storage              → DB
 ├── DownloadQueue
 ├── YouTubeFetcher       → Logger.getLogger('YouTubeFetcher')
 ├── RSSFetcher           → Logger.getLogger('RSSFetcher')
 ├── LLMService           → Logger.getLogger('LLMService'), BaseLLMProvider 子類別
 └── Scheduler            → ConfigManager, DownloadQueue, YouTubeFetcher,
                            RSSFetcher, LLMService, Storage, DB,
                            Logger.getLogger('Scheduler')
```

**依賴注入策略**: Logger 採用 Singleton 模式，各模組 constructor 的 `logger` 參數為可選。未傳入時自動透過 `Logger.getLogger(category)` 取得；測試時可注入 mock logger。其餘模組仍透過 constructor injection 取得依賴。

---

## 2. 資料流程

### 2.1 主要處理 Pipeline

```
定時觸發 / 手動觸發
       │
       ▼
┌──────────────┐     ┌──────────────┐
│  Scheduler   │────▶│  Fetcher     │  (1) 掃描資料源，取得項目列表
│  _checkSource│     │  (YT / RSS)  │
└──────┬───────┘     └──────────────┘
       │
       │  lookbackDays 過濾 → maxItems 截取 → DB dedup → _pendingItems dedup
       ▼
┌──────────────┐
│ DownloadQueue│  (2) 新項目加入佇列，受並發限制
│   addTask    │      _pendingItems.add(itemId) 防重複
└──────┬───────┘
       │  佇列排程執行 task.execute()
       ▼
┌──────────────┐
│  Scheduler   │  (3) _processItem: 完整處理單一項目
│  _processItem│
└──┬───┬───┬───┘
   │   │   │
   │   │   ▼
   │   │  ┌──────────────┐
   │   │  │ YouTubeFetcher│  (3a) YouTube: 下載字幕文字
   │   │  │ fetchTranscript│      (RSS 內容已在 fetchItems 時取得)
   │   │  └──────────────┘
   │   ▼
   │  ┌──────────────┐
   │  │  LLMService  │  (3b) 呼叫 LLM 產生摘要（支援 per-source prompt）
   │  │  summarize   │       失敗 → 拋出錯誤，不儲存至 DB
   │  └──────┬───────┘
   │         ▼
   │  ┌──────────────┐
   │  │   Storage    │  (3c) 儲存原始內容 → Markdown + SQLite
   │  │  saveContent │
   │  └──────┬───────┘
   │         ▼
   │  ┌──────────────┐
   │  │   Storage    │  (3d) 更新摘要 → 追加到 Markdown + 更新 SQLite
   │  │ updateSummary│
   │  └──────────────┘
   │
   └──▶ _pendingItems.delete(itemId)  ← 完成或失敗時清除
```

**關鍵改動**: _processItem 先呼叫 LLM 摘要，成功後才 saveContent + updateSummary。LLM 失敗時整個項目不入 DB，由佇列重試機制處理。

### 2.2 資料狀態轉換

```
content_items.status:

  new ──────────▶ processed
   │   (LLM 摘要成功，saveContent + updateSummary 完成)
   │
   └──────────▶ new (維持)
       (無 LLM API Key，內容已儲存，摘要待補)
```

---

## 3. 各模組詳細設計

---

### 3.1 ConfigManager (`src/config.js`)

**職責**: 管理 JSON 設定檔的讀取、存取、以及檔案變更時的熱 reload。

**繼承**: `EventEmitter`

**Constructor**:
```javascript
new ConfigManager(configPath?)
// configPath 預設為 <project>/config/settings.json
```

**公開方法**:

| 方法 | 回傳 | 說明 |
|------|------|------|
| `load()` | `Object` | 同步讀取並解析設定檔，回傳完整設定物件 |
| `get()` | `Object` | 取得目前設定（若未載入則自動呼叫 `load()`） |
| `startWatching()` | `void` | 啟動 chokidar 監聽設定檔變更 |
| `stopWatching()` | `void` | 停止監聽 |
| `getDataPath()` | `string` | 回傳資料儲存目錄的絕對路徑 |
| `getDataSources()` | `Array` | 回傳所有資料源設定 |
| `getEnabledDataSources()` | `Array` | 回傳 `enabled: true` 的資料源 |
| `getLLMConfig()` | `Object` | 回傳 LLM 設定區塊 |
| `getSourcePrompt(sourceId)` | `string\|null` | 回傳指定資料源的自訂 prompt，無則回傳 `null` |
| `getDownloadConfig()` | `Object` | 回傳下載佇列設定區塊 |
| `getLogLevel()` | `string` | 回傳日誌等級 |

**事件**:

| 事件名稱 | 參數 | 觸發時機 |
|----------|------|----------|
| `changed` | `(newConfig, oldConfig)` | 設定檔變更且成功解析後 |
| `error` | `(Error)` | 設定檔變更但解析失敗時 |

**設定檔格式** (`config/settings.json`):

```json
{
  "version": "1.0",
  "app": {
    "logLevel": "info",
    "dataPath": "./data"
  },
  "download": {
    "concurrentLimit": 3,
    "retryAttempts": 3,
    "retryDelay": 1000,
    "timeoutMs": 30000
  },
  "dataSources": [
    {
      "id": "source-1",
      "type": "youtube",
      "name": "頻道顯示名稱",
      "url": "https://www.youtube.com/@channelname",
      "checkInterval": 3600,
      "enabled": true,
      "maxItems": 5,
      "lookbackDays": 7,
      "prompt": "（可選）此資料源的自訂 LLM 摘要 prompt"
    }
  ],
  "llm": {
    "provider": "openai",
    "apiKey": "",
    "model": "gpt-5-mini",
    "baseUrl": null,
    "summarizationPrompt": "你是一位專業的內容分析師...",
    "maxTokens": 16384,
    "temperature": 0.7
  }
}
```

**dataSources 新增欄位說明**:

| 欄位 | 型態 | 說明 |
|------|------|------|
| `maxItems` | `number` | 每次檢查最多處理的最新項目數量（DB dedup 前套用） |
| `lookbackDays` | `number` | 只處理 N 天內發布的項目 |
| `prompt` | `string` | 此資料源的自訂 LLM 摘要 prompt，覆蓋全域 `summarizationPrompt` |

**llm 新增欄位說明**:

| 欄位 | 型態 | 說明 |
|------|------|------|
| `summarizationPrompt` | `string` | 全域預設摘要 prompt，覆蓋內建 DEFAULT_SUMMARIZE_PROMPT |

---

### 3.2 Logger (`src/logger.js`)

**職責**: 提供分級日誌，同時輸出到 console 和檔案。採用 **Singleton 模式**，全域只有一個 Logger 實例，各模組透過 `Logger.getLogger(category)` 取得輕量委派物件。

**Singleton API** (靜態方法):

| 方法 | 回傳 | 說明 |
|------|------|------|
| `Logger.init(options?)` | `Logger` | 初始化全域 Logger 實例，回傳實例本身 |
| `Logger.getLogger(category)` | `Object` | 回傳輕量委派物件 `{ info, warn, error, debug }` |
| `Logger.setLevel(level)` | `void` | 動態調整全域日誌等級 |
| `Logger.close()` | `void` | 關閉檔案 stream |
| `Logger.reset()` | `void` | 關閉並銷毀實例（主要供測試使用） |

**`Logger.getLogger(category)` 回傳物件**:

```javascript
{
  info:  (msg) => Logger._instance?._write('info', msg, category),
  warn:  (msg) => Logger._instance?._write('warn', msg, category),
  error: (msg) => Logger._instance?._write('error', msg, category),
  debug: (msg) => Logger._instance?._write('debug', msg, category),
}
```

此物件不保存對實例的參照，透過 `Logger._instance` 間接呼叫，因此即使 Logger 尚未初始化也不會拋錯（靜默忽略）。

**Init Options** (`LoggerConfig`):

| 選項 | 預設值 | 說明 |
|------|--------|------|
| `level` | `'info'` | 日誌等級 |
| `category` | `'App'` | 預設分類 |
| `logDir` | `<project>/logs/` | 日誌目錄 |
| `logFile` | `'app.log'` | 日誌檔名 |
| `retentionDays` | `7` | 保留天數，超過自動刪除 |

**日誌等級** (由低到高): `error` → `warn` → `info` → `debug`

**輸出格式**:
```
[2026-02-11 10:05:03.123] [YouTubeFetcher] [INFO] Downloading transcript: "Video 1"
```

時間戳使用本地時區（非 UTC）。

**日誌 Rotation**:
- 每次寫入時檢查日期是否變更
- 日期變更時，將當前 `app.log` 重新命名為 `app.log.YYYY-MM-DD`
- 自動刪除超過 `retentionDays` 的舊日誌檔案

---

### 3.3 DB (`src/database/db.js`)

**職責**: 封裝 SQLite 資料庫操作，提供 content_items 和 data_sources 的 CRUD。

**Constructor**:
```javascript
new DB(dbPath)
// dbPath: SQLite 檔案的絕對路徑
```

**初始化**: `open()` 方法會自動建立目錄、開啟資料庫、設定 WAL mode、並執行 `schema.sql` 建立資料表。

**公開方法**:

| 方法 | 回傳 | 說明 |
|------|------|------|
| `open()` | `this` | 開啟資料庫並初始化 schema |
| `close()` | `void` | 關閉資料庫連線 |
| `insertContentItem(item)` | `RunResult` | 新增內容記錄 (`INSERT OR IGNORE`) |
| `updateContentSummary(itemId, summary)` | `RunResult` | 更新摘要，狀態改為 `processed` |
| `getContentItemByItemId(itemId)` | `Object\|undefined` | 依 item_id 查詢單筆 |
| `getContentItems({ status?, sourceType?, limit?, offset? })` | `Array` | 查詢內容清單（分頁、篩選） |
| `itemExists(itemId)` | `boolean` | 檢查 item_id 是否已存在 |
| `upsertDataSource(source)` | `RunResult` | 新增或更新資料源 |
| `updateLastCheck(sourceId)` | `void` | 更新資料源的最後檢查時間 |
| `getStats()` | `Object` | 取得統計資訊 |

> **注意**: `updateContentSummary` 已簡化為只接收 `(itemId, summary)` 兩個參數，不再接收 tags。

**資料表結構** (`src/database/schema.sql`):

| 資料表 | 用途 |
|--------|------|
| `content_items` | 儲存抓取的內容元數據（標題、URL、摘要、狀態等） |
| `data_sources` | 儲存資料源設定（目前 POC 主要由 JSON 設定檔驅動） |
| `llm_configs` | 儲存 LLM 設定（目前 POC 主要由 JSON 設定檔驅動） |

**content_items 欄位**:

| 欄位 | 型態 | 說明 |
|------|------|------|
| `id` | INTEGER PK | 自增主鍵 |
| `source_type` | TEXT | `'youtube'` 或 `'rss'` |
| `source_id` | TEXT | 對應設定檔中的資料源 id |
| `item_id` | TEXT UNIQUE | 內容唯一識別碼（video_id 或 RSS hash） |
| `title` | TEXT | 標題 |
| `url` | TEXT | 原始連結 |
| `author` | TEXT | 作者/頻道名稱 |
| `published_date` | DATETIME | 發布時間 |
| `fetched_date` | DATETIME | 抓取時間 |
| `markdown_file_path` | TEXT | Markdown 檔案相對路徑 |
| `summary` | TEXT | LLM 摘要 |
| `tags` | TEXT | JSON array 格式的標籤 |
| `status` | TEXT | `'new'` → `'processed'` |
| `created_at` | DATETIME | 建立時間 |
| `updated_at` | DATETIME | 更新時間 |

**索引**: `source_id`, `status`, `published_date`, `source_type`

---

### 3.4 Storage (`src/storage.js`)

**職責**: 管理 Markdown 檔案和 SQLite 的雙寫，確保兩者資料一致。

**Constructor**:
```javascript
new Storage(db, dataPath, options?)
// db:       DB 實例
// dataPath: 資料根目錄（含 content/ 子目錄）
// options.contentFormatters: { [sourceType]: (item) => string }  自訂格式化函式
```

**公開方法**:

| 方法 | 回傳 | 說明 |
|------|------|------|
| `saveContent(item)` | `Promise<string>` | 建立 Markdown 檔並寫入 SQLite，回傳相對路徑 |
| `updateSummary(item, summaryText)` | `Promise<void>` | 追加摘要到 Markdown 檔並更新 SQLite |

**saveContent 的 item 參數**:

```javascript
{
  sourceType: 'youtube' | 'rss',
  sourceId:   'yt-nana',              // 設定檔中的 id
  itemId:     'dQw4w9WgXcQ',         // 唯一識別碼
  title:      '影片或文章標題',
  url:        'https://...',
  author:     '作者名稱',             // 可選
  publishedDate: '2026-02-11T...',   // 可選，ISO 格式
  content:    '完整內容文字',
}
```

**updateSummary 參數**:

```javascript
updateSummary(item, summaryText)
// item:        需包含 itemId（用於 DB 查詢與 fallback 路徑計算）
// summaryText: LLM 回傳的原始摘要文字（string），格式由 prompt 決定
```

摘要追加到 Markdown 檔案時，格式為：

```markdown
## AI 摘要

{summaryText}
```

**Markdown 檔案路徑規則**:
```
data/content/{sourceId}/{YYYY-MM-DD}_{safeItemId}.md
```
- `sourceId`: 設定檔中的資料源 id（如 `yt-nana`、`rss-stratechery`）；若無 sourceId 則 fallback 到 sourceType
- `YYYY-MM-DD`: 取自 `publishedDate`，若無則用當天日期
- `safeItemId`: item_id 中非 `[a-zA-Z0-9_-]` 字元替換為 `_`

**Content Formatter**:

內建預設 formatter 依 sourceType 格式化原始內容區塊：

| sourceType | 格式 |
|------------|------|
| `youtube` | `### YouTube 字幕\n\n{content}` |
| `rss` | `### RSS 文章內容\n\n{content}` |

可透過 constructor `options.contentFormatters` 覆蓋或新增 formatter。

**Markdown 檔案結構**:
```markdown
---
title: 標題
source: youtube
item_id: abc123
author: 頻道名稱
published: 2026-02-11T10:30:00Z
url: https://...
fetched: 2026-02-11T12:00:00Z
---
# 標題

## 原始內容

### YouTube 字幕
[完整字幕文字]

## AI 摘要          ← updateSummary 追加
[LLM 摘要文字，格式由 prompt 決定]
```

---

### 3.5 YouTubeFetcher (`src/fetchers/youtube.js`)

**職責**: 掃描 YouTube 頻道取得最新影片列表，並透過 `yt-dlp` 下載影片字幕。

**Constructor**:
```javascript
new YouTubeFetcher(logger?)
// logger: 可選，未傳入時使用 Logger.getLogger('YouTubeFetcher')
```

**靜態方法**:

| 方法 | 回傳 | 說明 |
|------|------|------|
| `YouTubeFetcher.validateChannelUrl(url)` | `boolean` | 驗證 YouTube 頻道 URL 格式 |

**URL 格式**:支援 `@handle`、`channel/UCxx`、`c/name`，允許尾端 `/`（如 `https://www.youtube.com/@channelname/`）。

**公開方法**:

| 方法 | 回傳 | 說明 |
|------|------|------|
| `fetchRecentVideos(channelUrl)` | `Promise<Array>` | 取得頻道最近影片列表 |
| `fetchTranscript(videoId)` | `Promise<string>` | 下載影片字幕全文 |

**fetchRecentVideos 回傳格式**:
```javascript
[{
  videoId: 'dQw4w9WgXcQ',
  title: '影片標題',
  publishedDate: '2026-02-11T10:30:00Z',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  author: '頻道名稱',
}]
```

**實作細節**:
- **頻道掃描**: 不使用 YouTube Data API（無需 API Key）。先透過 HTTP 抓取頻道頁面 HTML，解析出 `channelId`（UC 開頭），再讀取 YouTube 內建的 RSS feed `https://www.youtube.com/feeds/videos.xml?channel_id={channelId}`。
- **字幕下載**: 使用系統安裝的 `yt-dlp` 命令列工具，以 `--write-auto-sub` 下載自動生成字幕（VTT 格式），再解析為純文字。
- **多語言優先序**: `zh-TW` → `zh-Hant` → `zh-Hans` → `zh-CN` → `en`。依序嘗試，取得第一個有效字幕即回傳。
- **VTT 解析** (`_parseVTT`): 移除 WEBVTT header、時間戳、HTML 標籤，透過 Set 去除重複行，最後以空格拼接為單一字串。
- **Channel ID 解析策略**:
  1. 從 HTML 中的 JSON 尋找 `"channelId"` 或 `"externalId"`
  2. Fallback: 從 `<link rel="canonical">` 取得

---

### 3.6 RSSFetcher (`src/fetchers/rss.js`)

**職責**: 解析 RSS/Atom Feed，取得最近文章列表及內容。

**Constructor**:
```javascript
new RSSFetcher(logger?)
// logger: 可選，未傳入時使用 Logger.getLogger('RSSFetcher')
```

**靜態方法**:

| 方法 | 回傳 | 說明 |
|------|------|------|
| `RSSFetcher.validateFeedUrl(url)` | `boolean` | 驗證 RSS feed URL 格式 |

**公開方法**:

| 方法 | 回傳 | 說明 |
|------|------|------|
| `fetchItems(feedUrl)` | `Promise<Array>` | 解析 feed 並回傳文章列表 |

**fetchItems 回傳格式**:
```javascript
[{
  itemId: 'rss-a1b2c3d4e5...',       // SHA1 hash (feedUrl + guid/link/title)
  title: '文章標題',
  content: '文章完整內容 (HTML)',
  publishedDate: '2026-02-11T10:30:00Z',
  url: 'https://example.com/article-1',
  author: '作者名稱',
}]
```

**實作細節**:
- 使用 `rss-parser` 套件，支援 RSS 2.0 和 Atom 格式
- 內容欄位優先順序: `content:encoded` → `content` → `contentSnippet`
- Item ID: 以 `feedUrl` + (`guid` | `link` | `title`) 計算 SHA1 hash，前綴 `rss-`

---

### 3.7 LLMService (`src/llm/index.js`)

**職責**: LLM 統一入口，依設定分派到對應的 provider 實例。

**Constructor**:
```javascript
new LLMService(config, logger?)
// config: settings.json 中的 llm 區塊（或 LLMServiceConfig 實例）
// logger: 可選，未傳入時使用 Logger.getLogger('LLMService')
```

**公開方法**:

| 方法 | 回傳 | 說明 |
|------|------|------|
| `summarize(content, title, customPrompt?)` | `Promise<string>` | 呼叫 LLM 產生摘要，回傳原始文字 |
| `chat(messages, options?)` | `Promise<string>` | 通用 chat API，直接委派至 provider |
| `updateConfig(config)` | `void` | 動態切換 provider/model |

**summarize 行為**:

| 情境 | 行為 |
|------|------|
| 有 `customPrompt`（per-source prompt） | 使用 customPrompt 作為 system message，直接送 LLM，回傳原始文字 |
| 有 `summarizationPrompt`（全域設定） | 使用 summarizationPrompt 作為 system message，直接送 LLM，回傳原始文字 |
| 皆無（使用內建 DEFAULT_SUMMARIZE_PROMPT） | 附加 JSON 格式指示，要求 LLM 回傳 `{ "summary": "..." }`，解析後回傳 summary 欄位 |

**chat 方法**:
```javascript
// 通用 chat completion — 直接傳遞 messages 和 options 給 provider
const response = await llmService.chat(
  [{ role: 'user', content: '你好' }],
  { responseFormat: 'text' }
);
```

**Provider 分派邏輯**:

| `config.provider` 值 | 對應 Provider |
|-----------------------|---------------|
| `"openai"` | OpenAIProvider |
| `"openai-compatible"` | OpenAIProvider（使用自訂 baseUrl） |
| `"gemini"` | GeminiProvider |

---

### 3.8 BaseLLMProvider (`src/llm/base.js`)

**職責**: Provider 抽象基底類別，定義統一介面。

**Constructor**:
```javascript
new BaseLLMProvider(config, logger?)
// config: LLMProviderConfig 或相容物件
// logger: 可選，未傳入時使用 Logger.getLogger('LLMProvider')
```

**介面**:

| 方法 | 回傳 | 說明 |
|------|------|------|
| `chatCompletion(messages, options?)` | `Promise<string>` | 通用 chat API（子類別必須實作） |
| `_parseJSON(text)` | `Object` | 安全解析 JSON，失敗回傳 `{ raw: text }` |

**messages 格式**:
```javascript
[
  { role: 'system', content: '系統提示' },
  { role: 'user', content: '使用者訊息' },
]
```

**options**:

| 選項 | 值 | 說明 |
|------|----|------|
| `responseFormat` | `'json'` \| `'text'` | 回應格式，`'json'` 時 provider 會啟用對應機制 |

---

### 3.9 OpenAIProvider (`src/llm/openai.js`)

**職責**: 呼叫 OpenAI Chat Completions API（也相容 OpenAI-compatible 端點）。

**繼承**: `BaseLLMProvider`

**Constructor**:
```javascript
new OpenAIProvider(config, logger?)
// 若 config.baseUrl 有值，則設為 OpenAI client 的 baseURL
```

**chatCompletion 實作細節**:
- 若 messages 中已包含 `role: 'system'`，不再額外加入 provider-level systemPrompt
- `responseFormat: 'json'` 時設定 `response_format: { type: 'json_object' }`
- GPT-5 系列模型使用 `max_completion_tokens`（非 `max_tokens`），且不傳 `temperature`

---

### 3.10 GeminiProvider (`src/llm/gemini.js`)

**職責**: 呼叫 Google Gemini API。

**繼承**: `BaseLLMProvider`

**chatCompletion 實作細節**:
- 使用 `@google/generative-ai` SDK
- 系統訊息優先使用 messages 中的 `role: 'system'`，否則 fallback 到 provider-level systemPrompt
- 角色映射: `assistant` → `model`（Gemini API 格式）
- `responseFormat: 'json'` 時設定 `responseMimeType: 'application/json'`

---

### 3.11 DownloadQueue (`src/queue.js`)

**職責**: 管理下載/處理任務的佇列，控制並發數量，失敗時自動重試（指數退避）。

**繼承**: `EventEmitter`

**Constructor**:
```javascript
new DownloadQueue(options?)
// 接受 QueueConfig 實例或 plain object
// concurrentLimit 預設 3
// retryAttempts   預設 3
// retryDelay      預設 1000 (ms)
```

**公開方法**:

| 方法 | 回傳 | 說明 |
|------|------|------|
| `addTask(task)` | `void` | 加入任務到佇列 |
| `getStatus()` | `Object` | 取得佇列狀態統計 |
| `updateConcurrentLimit(n)` | `void` | 動態調整並發上限 |
| `isEmpty` | `boolean` (getter) | 佇列是否完全空閒 |

**Task 物件格式**:
```javascript
{
  id: 'unique-id',
  name: '任務顯示名稱',
  execute: async () => { ... },  // 實際執行的 async function
}
```

**佇列內部會自動附加的屬性**: `retryCount`, `maxRetries`, `result`, `error`

**事件**:

| 事件 | 參數 | 說明 |
|------|------|------|
| `taskAdded` | `(task, status)` | 任務加入佇列 |
| `taskStarted` | `(task, status)` | 任務開始執行 |
| `taskCompleted` | `(task, status)` | 任務完成 |
| `taskRetry` | `(task, retryCount, delay, status)` | 任務失敗，準備重試 |
| `taskFailed` | `(task, error, status)` | 任務最終失敗（已用盡重試） |

**status 物件格式**:
```javascript
{ pending: 2, active: 3, completed: 10, failed: 1 }
```

**重試機制**:
- 策略: 指數退避 (exponential backoff)
- 延遲計算: `retryDelay * 2^(retryCount - 1)`
- 例如 `retryDelay: 1000` → 第 1 次重試 1s、第 2 次 2s、第 3 次 4s
- 超過 `maxRetries` 次後，任務移入 `failed` 清單

**並發控制**: 每次有任務完成或加入時，自動從 pending 取出任務填滿到 `concurrentLimit`。

---

### 3.12 Scheduler (`src/scheduler.js`)

**職責**: 核心協調者。管理定時排程、資料源檢查、以及單一項目的完整處理流程。

**Constructor**:
```javascript
new Scheduler({
  configManager, queue, youtubeFetcher, rssFetcher,
  llmService, storage, db, logger?
})
// logger: 可選，未傳入時使用 Logger.getLogger('Scheduler')
```

**公開方法**:

| 方法 | 回傳 | 說明 |
|------|------|------|
| `start()` | `void` | 啟動排程（每個資料源依 checkInterval 定時檢查） |
| `stop()` | `void` | 停止所有排程 |
| `restart()` | `void` | 重啟排程（設定變更時使用） |
| `checkNow()` | `Promise<void>` | 手動觸發所有啟用資料源的檢查 |
| `checkSource(sourceId)` | `Promise<void>` | 手動觸發單一資料源的檢查 |

**排程機制**:
- 使用 `setInterval`（而非 cron 表達式），以支援任意秒數間隔
- 首次檢查: 啟動後延遲 5 秒執行
- 後續檢查: 依各資料源的 `checkInterval` 設定

**_checkSource 處理流程** (資料源層級):

```
1. Fetcher 取得項目列表
       │
       ▼
2. lookbackDays 過濾（若設定）
   → 移除發布時間早於 N 天前的項目
       │
       ▼
3. maxItems 截取（若設定）
   → 只保留最新的 N 筆（在 DB dedup 前套用）
       │
       ▼
4. DB dedup (db.itemExists) + _pendingItems dedup
   → 過濾已存在於 DB 或正在佇列中的項目
       │
       ▼
5. 新項目加入 DownloadQueue
   → _pendingItems.add(itemId) 防止同一項目重複加入佇列
```

**_processItem 處理流程** (單一項目):

```
1. YouTube 類型 → 下載字幕 (youtubeFetcher.fetchTranscript)
   RSS 類型 → 內容已在 fetchItems 時取得
       │
       ▼
2. 檢查 LLM 設定
   ├─ 有 API Key → llmService.summarize(content, title, sourcePrompt)
   │               sourcePrompt 來自 configManager.getSourcePrompt(source.id)
   │               → summaryText = LLM 回傳文字
   │
   └─ 無 API Key → summaryText = null，日誌警告
       │
       ▼
3. storage.saveContent(item)
   → 寫入 Markdown 檔案 + SQLite 記錄 (status: 'new')
       │
       ▼
4. summaryText 存在時 → storage.updateSummary(item, summaryText)
   → 追加摘要到 Markdown + 更新 SQLite (status: 'processed')
```

**關鍵設計**: LLM 摘要在 saveContent 之前執行。若 LLM 失敗，整個 _processItem 拋出錯誤，項目不會寫入 DB，由 DownloadQueue 的重試機制自動重試。

**_pendingItems (Set)**:
- `addTask` 時 `.add(itemId)` — 防止同一 item 在佇列消化前被重複加入
- `taskCompleted` / `taskFailed` 時 `.delete(itemId)` — 完成或永久失敗後清除

---

## 4. 入口點 (`src/index.js`)

### 4.1 啟動流程

```
1.  載入設定檔 (ConfigManager.load)
2.  初始化 Logger singleton (Logger.init)
    → const logger = Logger.getLogger('App')
3.  開啟 SQLite 資料庫 (DB.open)
4.  建立 Storage 實例
5.  建立 DownloadQueue 實例 (QueueConfig)，綁定事件日誌
6.  建立 YouTubeFetcher 實例（無需傳入 logger，自動取得）
7.  建立 RSSFetcher 實例（無需傳入 logger，自動取得）
8.  建立 LLMService 實例（若有 API Key）
9.  建立 Scheduler 實例（無需傳入 logger，自動取得）
10. 啟動設定檔監聽 (ConfigManager.startWatching)
11. 啟動排程器 (Scheduler.start)
12. 註冊 SIGINT/SIGTERM 處理 → graceful shutdown
```

### 4.2 設定檔熱 Reload

設定檔變更時（透過 ConfigManager 的 `changed` 事件），index.js 會：
1. 更新 Logger 等級 (`Logger.setLevel`)
2. 更新 DownloadQueue 並發上限
3. 更新 LLMService 的 provider/model（或新建實例）
4. 重啟 Scheduler（套用新的資料源設定）

### 4.3 Graceful Shutdown

收到 `SIGINT` (Ctrl+C) 或 `SIGTERM` 時：
1. 停止 Scheduler
2. 停止設定檔監聽
3. 關閉 SQLite 連線
4. 關閉 Logger (`Logger.close()`)
5. 結束程序

---

## 5. 外部依賴

### NPM 套件

| 套件 | 版本 | 用途 |
|------|------|------|
| `better-sqlite3` | ^11.0.0 | SQLite 資料庫（同步 API，高效能） |
| `rss-parser` | ^3.13.0 | RSS/Atom Feed 解析 |
| `openai` | ^4.20.0 | OpenAI API SDK |
| `@google/generative-ai` | ^0.21.0 | Google Gemini API SDK |
| `axios` | ^1.7.0 | HTTP 請求（YouTube 頻道頁抓取） |
| `node-cron` | ^3.0.3 | (已引入但實際使用 setInterval) |
| `chokidar` | ^3.6.0 | 設定檔變更監聽 |
| `fs-extra` | ^11.2.0 | 增強檔案操作（ensureDir 等） |
| `gray-matter` | ^4.0.3 | Markdown front matter 解析/生成 |

### 系統工具

| 工具 | 用途 |
|------|------|
| `yt-dlp` | YouTube 字幕下載（需預先安裝於系統 PATH） |

---

## 6. 為日後整合預留的接口

本階段所有模組設計為 **純 Node.js class**，無任何 Electron/UI 依賴。整合 Electron 時的對接點：

| 模組 | 整合方式 |
|------|----------|
| **ConfigManager** | 可改為從 `electron-store` 讀取設定，或維持 JSON 設定檔 |
| **Storage** | `dataPath` 改為指向 `app.getPath('userData')` |
| **DownloadQueue** | 監聽事件通知 UI 更新（透過 IPC 或 WebSocket） |
| **Scheduler** | `checkNow()` / `checkSource()` 可由 Express API 或 IPC 呼叫 |
| **DB** | `getContentItems()` / `getStats()` 可直接作為 API 資料來源 |
| **LLMService** | `updateConfig()` 可由設定頁面觸發 |

---

## 7. 檔案結構總覽

```
XQDigest/
├── package.json
├── CLAUDE.md
├── .gitignore
├── doc/
│   ├── XQDigest_技術規格_v1.2.md
│   └── Phase0_模組設計文件.md        ← 本文件
├── config/
│   └── settings.json
├── src/
│   ├── index.js
│   ├── config.js
│   ├── logger.js
│   ├── queue.js
│   ├── scheduler.js
│   ├── storage.js
│   ├── database/
│   │   ├── db.js
│   │   └── schema.sql
│   ├── fetchers/
│   │   ├── youtube.js
│   │   └── rss.js
│   └── llm/
│       ├── base.js
│       ├── index.js
│       ├── openai.js
│       └── gemini.js
├── tests/                           ← 測試程式
│   └── test-*.js
├── data/                            ← git ignored
│   ├── database/
│   │   └── content.db
│   └── content/
│       ├── {sourceId}/              ← 如 yt-nana/, rss-stratechery/
│       │   ├── 2026-02-11_videoId1.md
│       │   └── 2026-02-12_videoId2.md
│       └── ...
└── logs/                            ← git ignored
    ├── app.log                      ← 當日日誌
    └── app.log.2026-02-10           ← 已 rotate 的日誌
```
