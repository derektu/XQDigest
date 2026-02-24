# Phase 7：OpenAI OAuth 整合設計文件

## 概述

Phase 7 新增 OpenAI OAuth 登入方式，讓使用者除輸入 API Key 外，也可透過 OpenAI 帳號授權使用 LLM。

- **OAuth 模型**：`gpt-5.2`，透過 `https://chatgpt.com/backend-api/codex/responses`（Responses API，強制 SSE streaming）
- **PKCE 流程**：瀏覽器開啟 OpenAI 授權頁面，本機 port 1455 接收 callback，無需 client secret
- **Token 管理**：短期 access token + refresh token 自動續期，存於 SQLite `app_settings`
- **Streaming 統一**：藉機將 OpenAI / Gemini provider 一併改為 streaming，支援 `onChunk` callback

---

## 架構決策

| 決策 | 說明 |
|------|------|
| PKCE OAuth 不使用 client secret | 符合 OAuth 2.0 for Public Clients 規範，無 secret 外洩風險 |
| Port 1455 callback server | 與主 API server（預設 3579）分開，獨立生命週期，login 完成即關閉 |
| `OAuthClient` 注入 `storage` | 測試時傳入 file storage，AppEngine 傳入 DB storage，不需 mock 整個 DB |
| 注入 `openBrowser` callback | Electron 環境改用 `shell.openExternal`，CLI 用 `open` 套件，不硬耦合 |
| streaming 對呼叫者透明 | `chatCompletion()` 回傳介面不變（`{text, usage}`），`onChunk` 為可選 options，LLMQueue 無需改動 |
| OAuth provider usage = null | Responses API 不回傳 token 計數，`usage` 欄位固定為 `null` |

---

## 實作順序

```
Phase 7.1  OAuth Foundation Module（OAuthClient class）
Phase 7.2  OpenAI OAuth LLM Provider（整合進 LLMService）
Phase 7.3  全面 Streaming 架構（openai.js / gemini.js）
Phase 7.4  Backend 整合（AppEngine + REST routes）
Phase 7.5  UI 整合（React Settings）
```

---

## Phase 7.1：OAuth Foundation Module

### 新增 `src/llm/openai-oauth-client.js`

CommonJS class，封裝 PKCE 登入流程、token 持久化、refresh、及 SSE chat completion。

**建構子參數：**

```javascript
new OAuthClient({
  storage,      // { load(), save(tokens), delete() }，預設 file storage
  openBrowser,  // (url) => void，預設 require('open')
  tokensPath,   // file storage 時的路徑，預設 path.join(dataDir, 'oauth_tokens.json')
})
```

**公開介面：**

| 方法 | 說明 |
|------|------|
| `login()` | 啟動 PKCE 流程（開瀏覽器 + 本機 1455 callback），回傳 `Promise<{accountId, expires}>` |
| `logout()` | 刪除 token，回傳 `Promise<void>` |
| `getValidToken()` | 若 access token 未過期直接回傳；否則先 refresh，回傳 `Promise<string>` |
| `chatCompletion(messages, options)` | 呼叫 Responses API（SSE），回傳 `Promise<{text, usage: null}>` |
| `getStatus()` | 同步回傳 `{loggedIn, accountId, expires}`（從 storage 讀） |

**常數（沿用 openai-oauth 專案）：**

```javascript
const CLIENT_ID        = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTH_URL         = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL        = 'https://auth.openai.com/oauth/token';
const REDIRECT_URI     = 'http://localhost:1455/auth/callback';
const SCOPES           = 'openid profile email offline_access';
const API_URL          = 'https://chatgpt.com/backend-api/codex/responses';
const LOGIN_TIMEOUT_MS = 60 * 1000;  // 60 秒，逾時後 callback server 關閉並 reject
```

**PKCE authorization URL 額外參數（OpenAI OAuth flow 所需）：**

```
id_token_add_organizations: 'true'
codex_cli_simplified_flow: 'true'
originator: 'pi'
```

**Token 格式：**

```json
{
  "access":    "<JWT>",
  "refresh":   "<refresh_token>",
  "expires":   1234567890000,
  "accountId": "61588b24-..."
}
```

**SSE 解析（`chatCompletion` 內部）：**

```
response.body → ReadableStream
  → 逐行解析 "data: {...}" 事件
  → type="response.output_text.delta" → 累積 delta
  → type="response.done" → 結束
  → 若 options.onChunk 有傳入，每個 delta 呼叫一次
  → 回傳完整 {text, usage: null}
```

**Responses API 請求格式：**

```json
{
  "model":        "gpt-5.2",
  "instructions": "<system message content>",
  "input":        [{ "role": "user", "content": "..." }],
  "stream":       true,
  "store":        false
}
```

**messages 轉換規則（Chat Completions → Responses API）：**

- `role === 'system'` → `instructions` 欄位（多個 system message 合併換行）
- 其餘 → `input` array（role / content 維持原樣）

**Storage 介面（file 預設實作）：**

```javascript
{
  load:   () => tokens | null,              // 讀取，parse JSON
  save:   (tokens) => void,                // 寫入，stringify JSON
  delete: () => void,                      // 刪除（logout 用）
}
```

### 新增 `tests/integration-openai-oauth-client.js`

| 測試項目 | 說明 |
|---------|------|
| PKCE 格式 | `verifier` / `challenge` 均為 base64url，verifier 約 43 字元，challenge 為 SHA-256 |
| Token 存檔/讀檔 | `save()` / `load()` 往返正確（mock file storage） |
| `getValidToken()` token 有效 | 直接回傳 access token，不呼叫 fetch |
| `getValidToken()` token 過期 | 呼叫 refresh endpoint，更新 storage |
| `chatCompletion()` SSE 解析 | mock fetch 回傳 SSE 事件流，驗證 text 組合正確 |
| `onChunk` callback | 每個 delta 都觸發一次 |
| `getStatus()` 未登入 | `{loggedIn: false}` |
| `getStatus()` 已登入 | `{loggedIn: true, accountId, expires}` |
| 網路測試（實際 login） | `try/catch` 包裹，無網路時 graceful skip |

---

## Phase 7.2：OpenAI OAuth LLM Provider

### 新增 `src/llm/openai-oauth.js`

繼承 `BaseLLMProvider`，建構子接受 `oauthClient` 參數。

```javascript
class OpenAIOAuthProvider extends BaseLLMProvider {
  constructor(oauthClient, logger) { ... }
  async chatCompletion(messages, options = {}) { ... }
}
```

`chatCompletion` 實作：
1. 轉換 messages 格式（Chat Completions → Responses API）
2. 呼叫 `this.oauthClient.chatCompletion(messages, options)`
3. 直接回傳 `{text, usage: null}`

`this.model` 預設 `'gpt-5.2'`（不可從外部 config 指定，由 API server 決定）。

### 修改 `src/llm/index.js`

`LLMServiceConfig` 新增欄位：

```javascript
this.oauthClient = config.oauthClient || null;  // OAuthClient 實例（optional）
```

`_createProvider()` 新增 case：

```javascript
case 'openai-oauth':
  if (!config.oauthClient) throw new Error('openai-oauth requires oauthClient');
  return new OpenAIOAuthProvider(config.oauthClient, logger);
```

### 新增 `tests/test-openai-oauth-provider.js`

| 測試項目 | 說明 |
|---------|------|
| 繼承 BaseLLMProvider | `instanceof` 驗證 |
| messages 格式轉換 | system → instructions, user → input，驗證傳入 oauthClient 的參數 |
| 回傳 `{text, usage: null}` | usage 必須為 null |
| LLMService 以 `'openai-oauth'` 初始化 | 傳入 mock oauthClient，驗證建立成功 |
| 無 oauthClient 拋錯 | `new LLMService({ provider: 'openai-oauth' })` 應拋出 |

---

## Phase 7.3：全面 Streaming 架構

**介面（不改變對外 API，onChunk 純屬可選擴充）：**

```javascript
// BaseLLMProvider.chatCompletion(messages, options)
// options.onChunk?: (chunk: string) => void
// returns: Promise<{text: string, usage: {...} | null}>
```

### 修改 `src/llm/base.js`

更新 JSDoc 說明 `options.onChunk` 語意，無程式碼邏輯變更。

### 修改 `src/llm/openai.js`

改用 streaming：

```javascript
const stream = await this.client.chat.completions.create({
  ...requestOptions,
  stream: true,
});

let text = '';
let usage = null;

for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta?.content ?? '';
  if (delta) {
    text += delta;
    options.onChunk?.(delta);
  }
  if (chunk.usage) {
    usage = {
      promptTokens: chunk.usage.prompt_tokens,
      completionTokens: chunk.usage.completion_tokens,
    };
  }
}
return { text, usage };
```

> 注意：OpenAI Node SDK streaming 最後一個 chunk 含 `usage`（需在 `create()` 加 `stream_options: { include_usage: true }`）。

### 修改 `src/llm/gemini.js`

改用 streaming：

```javascript
const result = await model.generateContentStream({ contents });

let text = '';
let usage = null;

for await (const chunk of result.stream) {
  const delta = chunk.text();
  if (delta) {
    text += delta;
    options.onChunk?.(delta);
  }
}
// usage 從最後的 aggregatedResponse 取得
const response = await result.response;
const meta = response.usageMetadata;
if (meta) {
  usage = {
    promptTokens: meta.promptTokenCount,
    completionTokens: meta.candidatesTokenCount,
  };
}
return { text, usage };
```

### 修改 `tests/test-llm.js`（或新增 integration test）

- 更新 mock：驗證 `onChunk` 有被正確呼叫
- 確認無 `onChunk` 時仍正確回傳完整 text
- 確認 usage 欄位仍正確回傳

---

## Phase 7.4：Backend 整合

### OAuthClient storage 介面擴充

`openai-oauth-client.js` 建構子：
- 原有 `tokensPath` file storage 路徑維持向後相容
- 新增 `storage` 可選參數，若傳入則優先使用，否則建立 file storage
- `_saveTokens(tokens)` → `this.storage.save(tokens)`
- `_loadTokensRaw()` → `this.storage.load()`
- `logout()` → `this.storage.delete()`

**DB storage 實作（AppEngine 建立）：**

```javascript
const dbStorage = {
  load:   () => db.getAppSetting('openai_oauth_tokens'),
  save:   (tokens) => db.setAppSetting('openai_oauth_tokens', tokens),
  delete: () => db.deleteAppSetting('openai_oauth_tokens'),
};
```

> `app_settings` 表已存在，key 為字串，value 為 JSON。無需 schema 變更。
> key 使用 `'openai_oauth_tokens'`（而非 `'oauth_tokens'`）以避免與其他 app_settings key 衝突。

### 修改 `src/app-engine.js`

**新增成員：**

```javascript
this._oauthClient = null;    // OAuthClient 實例
this._oauthLoginPromise = null;  // 進行中的 login Promise（防止重複觸發）
```

**`start()` 步驟 9 後新增（步驟 9.5 與 9.6）：**

```javascript
// 9.5. Init OAuthClient（注入 DB storage）
const { OAuthClient } = require('./llm/openai-oauth-client');
this._oauthClient = new OAuthClient({
  storage: dbStorage,
  openBrowser: this._resolveOpenBrowser(),
});

// 9.6. 若上次儲存的 provider 為 openai-oauth，此時才能初始化 LLMService
//       （step 9 的 apiKey 檢查無法涵蓋此 case）
if (llmSettings?.provider === 'openai-oauth') {
  const cfg = this._buildLLMConfig({ ...llmSettings, oauthClient: this._oauthClient });
  this._llmService = new LLMService(cfg, null, this._llmLogger);
}
```

**`_resolveOpenBrowser()` 實際實作：**

```javascript
_resolveOpenBrowser() {
  try {
    const { shell } = require('electron');
    if (typeof shell?.openExternal === 'function')
      return (url) => shell.openExternal(url);
  } catch { /* not in electron context */ }
  return async (url) => {
    const { default: open } = await import('open');
    open(url);
  };
}
```

**`setLLMSettings()` 新增 case：**

```javascript
if (data && data.provider === 'openai-oauth') {
  const cfg = this._buildLLMConfig({ ...data, oauthClient: this._oauthClient });
  this._llmService = new LLMService(cfg, null, this._llmLogger);
  ...
}
```

**新增方法：**

| 方法 | 說明 |
|------|------|
| `getOAuthStatus()` | 回傳 `this._oauthClient?.getStatus() \|\| {loggedIn: false}` |
| `startOAuthLogin()` | 若 `_oauthLoginPromise` 已在執行則直接回傳；否則建立新 Promise，完成後清除 |
| `logoutOAuth()` | 呼叫 `this._oauthClient?.logout()`，同時若當前 provider 為 oauth 則清除 `_llmService` |

**`_safeCleanup()` / `stop()`：**

- 新增 `this._oauthClient = null`（OAuthClient 無需顯式關閉）
- 若有進行中的 login (`_oauthLoginPromise`)，stop 時不強制中斷（browser flow 仍在進行）

### 修改 `src/api-routes.js`

新增三個 OAuth routes（放在現有 LLM routes 後面）：

```
GET    /api/settings/llm/oauth/status
POST   /api/settings/llm/oauth/login
DELETE /api/settings/llm/oauth/logout
```

**`GET /api/settings/llm/oauth/status`：**

```javascript
return { data: engine.getOAuthStatus?.() || { loggedIn: false } };
```

**`POST /api/settings/llm/oauth/login`：**

- 呼叫 `engine.startOAuthLogin()`（背景執行，不 await）
- 立即回傳 `{ data: { status: 'pending' } }`
- UI 後續 polling GET /status 確認完成

**`DELETE /api/settings/llm/oauth/logout`：**

```javascript
await engine.logoutOAuth?.();
return { data: { ok: true } };
```

**修改 `POST /api/settings/llm/test`：**

當 `provider === 'openai-oauth'` 時，不需 apiKey，改為驗證 OAuth token 狀態：

```javascript
if (provider === 'openai-oauth') {
  const status = engine.getOAuthStatus?.();
  if (!status?.loggedIn) {
    return { data: { valid: false, error: '尚未登入 OpenAI OAuth' } };
  }
  return { data: { valid: true, models: ['gpt-5.2'] } };
}
```

---

## Phase 7.5：UI 整合

### 修改 `renderer/src/ipc.js`

新增 OAuth API methods（在 `settings` 物件內）：

```javascript
export const settings = {
  getLLM:        ()     => _request('GET',    '/api/settings/llm'),
  updateLLM:     (data) => _request('PUT',    '/api/settings/llm', data),
  testLLM:       (p)    => _request('POST',   '/api/settings/llm/test', p),
  getOAuthStatus: ()    => _request('GET',    '/api/settings/llm/oauth/status'),
  loginOAuth:    ()     => _request('POST',   '/api/settings/llm/oauth/login'),
  logoutOAuth:   ()     => _request('DELETE', '/api/settings/llm/oauth/logout'),
};
```

### 修改 `renderer/src/hooks/useSettings.js`

新增 state 與方法：

```javascript
const [oauthStatus, setOauthStatus] = useState(null);   // {loggedIn, accountId, expires}
const [oauthPolling, setOauthPolling] = useState(false); // 是否正在 polling

const fetchOAuthStatus = useCallback(async () => { ... }, []);
const triggerOAuthLogin = useCallback(async () => {
  await settingsIpc.loginOAuth();
  setOauthPolling(true);
  // polling 每 2 秒一次，最多 300 秒，直到 loggedIn=true
}, []);
const logoutOAuth = useCallback(async () => {
  await settingsIpc.logoutOAuth();
  await fetchOAuthStatus();
}, []);
```

### 修改 `renderer/src/pages/SettingsPage.jsx`

**PROVIDERS 清單（實際實作順序）：**

```javascript
const PROVIDERS = [
  { value: 'openai-oauth',      label: 'OpenAI（帳號登入）' },
  { value: 'openai',            label: 'OpenAI（API Key）' },
  { value: 'gemini',            label: 'Google Gemini（API Key）' },
  { value: 'openai-compatible', label: 'OpenAI Compatible（API Key）' },
];
```

> 注意：openai-oauth 排第一（最顯眼），其他 provider label 均加上 `(API Key)` 後綴以區分。

**當 `form.provider === 'openai-oauth'` 時：**

- 隱藏 API Key 欄位
- 顯示 OAuth 狀態區塊：

```
┌─────────────────────────────────────────────┐
│ OpenAI 帳號授權                               │
│ 狀態：未登入  /  已登入：帳號 ...1a2b3c4d     │
│                   Token 到期：2025/12/31      │
│ [使用 OpenAI 帳號登入]  /  [登出]             │
└─────────────────────────────────────────────┘
```

- 點「登入」→ 呼叫 `triggerOAuthLogin()`，按鈕 disable，顯示「請在瀏覽器完成授權...」
- Polling 期間每 2 秒更新狀態，最多 300 秒
- 登入成功後恢復按鈕，顯示帳號資訊
- Model 欄位固定顯示 `gpt-5.2`（不可編輯）

**`makeInitialForm` 新增 oauth 欄位（不存入 form，僅顯示用）：**

`openai-oauth` provider 儲存時，`apiKey` 傳空字串，`model` 固定傳 `'gpt-5.2'`。

---

## DB 變更

無 schema 變更。OAuth tokens 存於既有 `app_settings` 表：

| key | value（JSON） |
|-----|---------------|
| `'openai_oauth_tokens'` | `{"access":"...","refresh":"...","expires":...,"accountId":"..."}` |

---

## 模組依賴圖（新增部分）

```
AppEngine
  └── OAuthClient (src/llm/openai-oauth-client.js)
        ├── storage: dbStorage (DB.getAppSetting/setAppSetting)
        └── openBrowser: electron.shell.openExternal | open

LLMService._createProvider('openai-oauth')
  └── OpenAIOAuthProvider (src/llm/openai-oauth.js)
        └── OAuthClient.chatCompletion()

api-routes.js
  ├── GET  /api/settings/llm/oauth/status  → engine.getOAuthStatus()
  ├── POST /api/settings/llm/oauth/login   → engine.startOAuthLogin()（背景）
  └── DEL  /api/settings/llm/oauth/logout  → engine.logoutOAuth()
```

---

## 新增 / 修改檔案清單

| 檔案 | 類型 | 說明 |
|------|------|------|
| `src/llm/openai-oauth-client.js` | 新增 | OAuthClient class（PKCE + token 管理 + SSE） |
| `src/llm/openai-oauth.js` | 新增 | OpenAIOAuthProvider（繼承 BaseLLMProvider） |
| `src/llm/index.js` | 修改 | 加入 `'openai-oauth'` case，LLMServiceConfig 加 `oauthClient` |
| `src/llm/base.js` | 修改 | 更新 JSDoc（onChunk 說明） |
| `src/llm/openai.js` | 修改 | 改為 streaming，支援 onChunk |
| `src/llm/gemini.js` | 修改 | 改為 streaming，支援 onChunk |
| `src/app-engine.js` | 修改 | 初始化 OAuthClient，新增 getOAuthStatus / startOAuthLogin / logoutOAuth |
| `src/api-routes.js` | 修改 | 新增三個 OAuth routes，修改 /test 支援 openai-oauth |
| `renderer/src/ipc.js` | 修改 | 新增 OAuth IPC methods |
| `renderer/src/hooks/useSettings.js` | 修改 | 新增 OAuth state / methods |
| `renderer/src/pages/SettingsPage.jsx` | 修改 | 新增 OpenAI OAuth UI 區塊 |
| `tests/integration-openai-oauth-client.js` | 新增 | OAuthClient 整合測試 |
| `tests/test-openai-oauth-provider.js` | 新增 | OpenAIOAuthProvider unit tests |
| `tests/test-llm.js` | 修改 | 更新 streaming mock，新增 onChunk 測試 |

---

## 測試驗證方式

| Phase | 驗證方式 |
|-------|---------|
| 7.1 | `npm test:integration` 通過；手動測試 browser OAuth flow，token 寫入 DB |
| 7.2 | `npm test` 通過；CLI 以 `'openai-oauth'` provider 呼叫 `LLMService.summarize()` |
| 7.3 | 各 provider unit test + streaming / onChunk callback 測試通過 |
| 7.4 | `curl` 測試 `/oauth/login`, `/oauth/status`, `/oauth/logout` endpoints |
| 7.5 | Electron app Settings 頁面可完成 OAuth 登入，切換 provider 後正常產生摘要 |

---

## 注意事項

1. **Port 1455 衝突**：若已被佔用，`server.listen` 會拋出 `EADDRINUSE`，需在 `login()` error handler 中包裹，回傳明確錯誤訊息。

2. **背景 login 與 UI polling**：`startOAuthLogin()` 背景執行，UI 每 2 秒 polling GET /status（最多 300 秒）。登入成功後 polling 停止，UI 顯示帳號資訊。

3. **Token 安全性**：access token 為 JWT，明文存於 SQLite（與 API Key 同等安全性）。未來可考慮 Electron `safeStorage` 加密，但 Phase 7 不在範圍內。

4. **Electron `shell.openExternal`**：須確認 Electron main process 允許呼叫（sandboxed renderer 不可直接用）。AppEngine 在 main process 執行，無此限制。

5. **`open` 套件 ESM**：`open@^10` 為 ESM-only，以 `await import('open')` dynamic import 解決，已在 package.json 使用 `open@^10.2.0`。`openai-oauth-client.js` 及 `app-engine.js` 的 fallback 均採此方式。
