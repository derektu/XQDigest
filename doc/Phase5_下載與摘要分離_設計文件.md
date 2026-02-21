# Phase 5：下載與摘要分離架構設計文件

## 概述

Phase 5 將下載與 LLM 摘要拆分為兩個獨立 pipeline，提升可靠性與可觀測性。

- **Stage 1（下載）**：由 DownloadQueue 驅動，下載完成後存入 DB（status=`fetched`）
- **Stage 2（摘要）**：由 LLMQueue 驅動，從 DB 讀取原始內容，呼叫 LLM 後更新摘要（status=`summarized`）

兩個 stage 獨立運行，互不阻塞。應用重啟後，status=`fetched` 的項目會自動重新加入 LLM queue 繼續處理。

---

## 架構決策

| 決策 | 說明 |
|------|------|
| 兩階段 pipeline | 下載（Stage 1）與摘要（Stage 2）完全解耦，LLM 失敗不影響下載佇列 |
| LLM Queue 單執行緒 | `_active` flag 確保同時只跑一個 LLM 任務，避免 API rate limit 競爭 |
| Sliding window rate limiting | 以 60 秒滑動視窗追蹤請求時間戳，精確對應 API 的 req/min 限制（非漏桶） |
| `fetched` 狀態持久化 | 下載完成即寫入 DB，重啟後自動掃描並續跑摘要，不遺漏任何項目 |
| LLM Logger 獨立日誌 | 每次 LLM 呼叫寫入 `logs/llm.log`，提供可觀測性與用量追蹤 |

---

## 狀態流程

```
new → fetched（下載完成）→ summarized（LLM 完成）
```

- 向後相容：舊資料 `processed` 視同 `summarized`（DB 查詢條件含三種狀態）
- 無 LLM 設定時：內容停在 `fetched`，設定完成後重啟自動續跑

---

## DB Schema 變更（`src/database/schema.sql`）

`content_items` 新增欄位：

```sql
raw_content TEXT    -- 原始下載內容（字幕文字、RSS 文章內容等）
```

---

## 新模組

### `src/llm-queue.js`（LLMQueue）

繼承 EventEmitter，管理 LLM 摘要任務的佇列與執行。

**設計特點：**
- 單執行緒：`_active` flag 確保同時只有一個任務在執行
- Sliding window rate limiting：以 `_requestTimestamps[]` 記錄 60 秒內的請求時間戳，超過上限時等待

**指數退避重試：**
```
delay = retryDelay × 2^(retryCount - 1)
```
例如：retryDelay=5000，三次重試間隔為 5s → 10s → 20s

**公開介面：**

| 方法 | 說明 |
|------|------|
| `addTask(id, fn, options?)` | 加入任務（fn 為非同步函式），回傳 Promise |
| `stop()` | 停止接受新任務，設定 `_stopped` flag |
| `drain()` | 等待所有進行中的任務完成（回傳 Promise） |
| `getStatus()` | 回傳 `{ queueLength, active, stopped }` |
| `updateRateLimit(rpm)` | 動態更新 requestsPerMinute |
| `isEmpty` | getter，佇列為空且無執行中任務時回傳 true |

**事件：**

| 事件 | 觸發時機 |
|------|---------|
| `taskAdded` | 任務加入佇列時 |
| `taskStarted` | 任務開始執行時 |
| `taskCompleted` | 任務成功完成時 |
| `taskRetry` | 任務失敗準備重試時 |
| `taskFailed` | 任務耗盡重試次數時 |
| `rateLimitWait` | 因 rate limit 等待時（含等待毫秒數） |

---

### `src/llm-logger.js`（LLMLogger）

使用與 `src/logger.js` 相同架構（daily rotation），寫入 `logs/llm.log`。

**記錄格式：**
```
[2025-01-01T00:00:00.000Z] itemId=xxx provider=openai model=gpt-4o-mini in=1234 out=567 ms=2345 status=success
[2025-01-01T00:00:00.000Z] itemId=xxx provider=gemini model=gemini-2.0-flash in=890 out=0 ms=1234 status=error error=rate limit exceeded
```

**公開介面：**

| 方法 | 說明 |
|------|------|
| `log(params)` | 記錄一次 LLM 呼叫，params: `{ itemId, provider, model, promptTokens, completionTokens, durationMs, status, error? }` |
| `close()` | 非同步 flush，回傳 Promise |

---

## AppEngine 變更（`src/app-engine.js`）

### `start()` 新增步驟

| 步驟 | 說明 |
|------|------|
| 步驟 8 | 初始化 `LLMLogger`（`this._llmLogger`） |
| 步驟 10 | 初始化 `LLMQueue`（rate limit 優先取 DB 設定的 `requestsPerMinute`，fallback 到 `defaults.llm.requestsPerMinute`） |
| 步驟 11 | Scheduler 建構時傳入 `llmQueue` 參數 |
| 步驟 14 | 呼叫 `_resumePendingSummaries()`：掃描 status=`fetched` 的項目，重新加入 LLM queue |

### `_resumePendingSummaries()`

```
啟動 → db.getItemsByStatus('fetched') → forEach → scheduler.enqueuePendingSummary(item)
```

### 其他新增

- `setLLMSettings()` 新增：呼叫 `llmQueue.updateRateLimit(rpm)` 動態套用新的 rate limit
- `stop()` / `_safeCleanup()`：依序執行 `llmQueue.stop()` → `llmQueue.drain()`（含 5 秒 timeout）→ `llmLogger.close()`

---

## Scheduler 變更（`src/scheduler.js`）

### 建構子

接受額外參數 `llmQueue`（可為 null，無 LLM 時不影響下載流程）。

### `_fetchContent()`（Stage 1）

```
下載完成
  → storage.saveContent(item, rawContent)   // 寫入 raw_content，status='fetched'
  → 若 llmQueue && llmService：
      llmQueue.addTask(item.id, () => _summarizeItem(item))
```

### `_summarizeItem(item)`（Stage 2）

```
從 item.raw_content 或 db.getContentItem(id).raw_content 取得原始內容
  → llmService.summarize(rawContent)
  → storage.updateSummary(id, summary)      // status='summarized'
```

### 新增方法

| 方法 | 說明 |
|------|------|
| `enqueuePendingSummary(item)` | 供 AppEngine 重啟續跑用，直接加入 LLMQueue |
| `updateLLMService(llmService)` | Phase 4 已有，Phase 5 同樣使用（動態更新 LLM 實例） |

---

## LLM Service 變更（`src/llm/index.js`）

建構子接受第三參數 `llmLogger`（可為 null）。

`summarize()` 完成後記錄：

```javascript
llmLogger?.log({
  itemId,
  provider: this._provider,
  model: this._model,
  promptTokens: usage.promptTokens,
  completionTokens: usage.completionTokens,
  durationMs: Date.now() - startTime,
  status: 'success',    // 或 'error'
  error: err?.message,  // 失敗時才有
});
```

---

## Storage 變更（`src/storage.js`）

| 方法 | 變更 |
|------|------|
| `saveContent(item, rawContent)` | 同時寫入 `raw_content` 欄位，status 設為 `'fetched'`（非舊的 `'processed'`） |
| `updateSummary(id, summary)` | 更新 summary 欄位，status 設為 `'summarized'` |

---

## DB 方法變更（`src/database/db.js`）

| 方法 | 變更 |
|------|------|
| `getContentItems()` | 查詢條件改為 `status IN ('fetched','summarized','processed')`（向後相容 `processed`） |
| `getItemsByStatus(status)` | 新增，回傳指定 status 的所有項目，供 `_resumePendingSummaries()` 使用 |
| `updateContentSummary(id, summary)` | 更新 summary 欄位，同時將 status 設為 `'summarized'` |

---

## 設定（`src/defaults.js`）

新增 `llm` 區塊：

```javascript
llm: {
  retryAttempts: 3,      // LLM 呼叫重試次數
  retryDelay: 5000,      // 重試初始間隔（ms），指數成長
  requestsPerMinute: 0,  // Rate limit（0 = 無限制）
}
```

優先序：DB LLM 設定的 `requestsPerMinute` > `defaults.llm.requestsPerMinute`。

可於 `config/settings.json` 的 `llm` 區塊覆寫：

```json
{
  "llm": {
    "retryAttempts": 5,
    "retryDelay": 3000,
    "requestsPerMinute": 10
  }
}
```

---

## 測試

| 測試檔案 | 說明 |
|---------|------|
| `tests/test-llm-queue.js` | 任務正常執行、失敗重試（指數退避）、rate limiting（sliding window）、stop/drain 優雅停止、getStatus 回傳正確狀態 |
| `tests/test-llm-logger.js` | 成功呼叫記錄（含 token 數）、失敗呼叫記錄（含 error 訊息）、timestamp 格式、close() async flush |

---

## 驗證步驟

1. `npm test` — 全部通過
2. 啟動後有新內容：log 顯示 `Content saved → Summarizing → Summary saved`
3. 中途關閉再重啟：log 顯示 `Resuming N pending summary item(s)...`
4. 設定 `requestsPerMinute`：log 顯示 `Rate limit: waiting Xms`
5. `logs/llm.log` 有各次 LLM 呼叫記錄（含 provider、model、token 數、耗時）
