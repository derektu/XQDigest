# Phase 4：Settings UI 設計文件

## 概述

Phase 4 提供 LLM 設定介面，讓使用者在 UI 內配置 LLM 參數（API key、model 選擇、驗證），並整合在 DataSources 管理的同一導覽框架內。

---

## 架構決策

| 決策 | 說明 |
|------|------|
| LLM 設定儲存位置 | DB（新的 `app_settings` table），**不再存於 settings.json** |
| settings.json 範圍 | 僅保留技術參數：app、download（進階用戶手動修改） |
| 未設定 LLM 時行為 | 不變：下載繼續，摘要跳過，`engine.status.llmConfigured = false` |
| UI 警示 | SourceNav footer 顯示橘色警示 banner，導向 /settings |

---

## DB Schema

**`src/database/schema.sql`** 新增：

```sql
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,          -- JSON 字串
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

LLM 設定範例：
- `key = 'llm'`
- `value = '{"provider":"openai","apiKey":"sk-xxx","model":"gpt-4o-mini","maxTokens":4096,"temperature":0.7,"summarizationPrompt":""}'`

---

## 新增 DB 方法（`src/database/db.js`）

| 方法 | 說明 |
|------|------|
| `getAppSetting(key)` | 讀取設定，JSON.parse(value) 後回傳，不存在則回傳 null |
| `setAppSetting(key, value)` | JSON.stringify(value) 後 INSERT OR REPLACE |

---

## AppEngine 變更（`src/app-engine.js`）

- **`start()`**：讀 `db.getAppSetting('llm')` 初始化 LLMService（替代原本的 `configManager.getLLMConfig()`）
- **移除** config hot-reload 中對 LLM 的處理
- **新增** `getLLMSettings()` → 從 DB 讀取，回傳 plain object 或 null
- **新增** `setLLMSettings(data)` → 寫 DB + 立即重新初始化 `this._llmService`

---

## Scheduler 變更（`src/scheduler.js`）

- **新增** `updateLLMService(llmService)` → 供 `setLLMSettings()` 呼叫，動態更新 scheduler 使用的 LLM 實例

---

## REST API 端點（`src/api-routes.js`）

### `GET /api/settings/llm`
- 回傳 DB 的 LLM 設定
- `apiKey` 顯示後 4 碼遮罩（例如：`"****xxxx"`）
- 未設定則回傳 `null`

### `PUT /api/settings/llm`
- Body: `{ provider, apiKey?, baseUrl?, model, maxTokens, temperature, summarizationPrompt }`
- 若 `apiKey` 以 `"****"` 開頭，不更新 apiKey（保留舊值）
- 呼叫 `engine.setLLMSettings(data)` 寫 DB + 重新初始化

### `POST /api/settings/llm/test`
- Body: `{ provider, apiKey, baseUrl? }`
- 建立暫時 provider 實例驗證 API key
- 成功: `{ valid: true, models: [...] }`
- 失敗: `{ valid: false, error: '...' }`

**模型列表邏輯：**
- `openai`：openai SDK `client.models.list()`，過濾含 `gpt-` 的模型
- `gemini`：GET `https://generativelanguage.googleapis.com/v1beta/models?key={apiKey}`，過濾含 `generateContent` 的模型
- `openai-compatible`：同 openai 帶 `baseURL`；list() 失敗時回傳空陣列（允許手動輸入）

---

## Renderer 架構

### `renderer/src/ipc.js`

新增 `settings` namespace：
```javascript
export const settings = {
  getLLM:    ()       => _request('GET',  '/api/settings/llm'),
  updateLLM: (data)   => _request('PUT',  '/api/settings/llm', data),
  testLLM:   (params) => _request('POST', '/api/settings/llm/test', params),
};
```

### `renderer/src/hooks/useSettings.js`（新建）

回傳：`{ llmSettings, loading, error, saveLLM, testLLM, testResult, testing }`

### `renderer/src/pages/SettingsPage.jsx`（新建）

UI 結構：
```
SettingsPage
├── Header（返回按鈕）
└── Section: LLM 設定
    ├── 未設定警示（isUnset 時顯示）
    ├── Provider selector
    ├── API Key input（password type）
    ├── Base URL input（openai-compatible 才顯示）
    ├── Model（驗證前 text input，驗證後 select dropdown）+ 驗證按鈕
    ├── ValidationStatus 顯示驗證結果
    ├── Max Tokens + Temperature（並排）
    ├── Summarization Prompt（textarea）
    └── 儲存設定按鈕（儲存成功短暫綠色提示）
```

### `renderer/src/App.jsx`

新增 `/settings` route：`<Route path="/settings" element={<SettingsPage />} />`

### `renderer/src/components/SourceNav.jsx`

- 新增引擎狀態輪詢（10 秒間隔），取得 `llmConfigured`
- LLM 未設定時在 footer 上方顯示橘色警示列
- footer 新增「⚙ 設定」導覽連結

---

## settings.json.example 變更

移除 `llm` 區段，改以 `_注意` 欄位說明 LLM 設定已改為 UI 管理。

---

## 測試

| 測試檔案 | 新增測試 |
|----------|---------|
| `tests/test-db.js` | `app_settings` table schema 確認；`getAppSetting()`/`setAppSetting()` 讀寫、覆蓋、多 key 測試 |
| `tests/test-api-server.js` | mock engine 新增 `getLLMSettings`/`setLLMSettings`；GET/PUT settings/llm 端點測試（null 回傳、儲存、遮罩邏輯） |

---

## 驗證步驟

1. `npm test` — 全部通過
2. 首次啟動（DB 無 LLM 設定）：SourceNav 顯示橘色警示 banner
3. 點擊警示 → Settings 頁，顯示「尚未設定」橘色提示
4. 輸入 API key → 驗證 → 模型下拉選單出現
5. 選擇 model → 儲存 → banner 消失
6. 重啟確認 LLM 設定持久化（apiKey 顯示遮罩，model 已選取）
