# XQDigest

財經資訊自動摘要工具。自動監控 YouTube 頻道與 RSS Feed，下載內容並透過 LLM 產生摘要。

## 專案進度

### Phase 0 — CLI 核心（已完成）

> 詳見 [doc/Phase0_模組設計文件.md](doc/Phase0_模組設計文件.md)

- 設定管理（`settings.json`）、Logger、SQLite 資料庫
- YouTube 頻道掃描，透過 yt-dlp 下載字幕（支援多語言優先序）
- RSS / Atom Feed 解析與內容抓取
- 呼叫 LLM（OpenAI / Gemini）產生摘要
- 原始內容與摘要以 Markdown + SQLite 雙寫儲存
- 下載佇列並發控制與指數退避重試；Scheduler 定時驅動完整 pipeline

### Phase 1 — Electron 桌面整合（已完成）

> 詳見 [doc/Phase1_Electron整合設計文件.md](doc/Phase1_Electron整合設計文件.md)

- AppEngine 狀態機，統一管理模組生命週期；CLI 與 Electron 共用核心
- 系統匣（tray）常駐，右鍵選單控制 Pause / Resume / Quit
- 跨平台 icon（macOS template image + Windows/Linux 標準 icon）
- `better-sqlite3` native module 的 Electron rebuild 支援

### Phase 2 — DataSources 管理 UI（已完成）

> 詳見 [doc/Phase2_DataSources_UI設計文件.md](doc/Phase2_DataSources_UI設計文件.md)

- 內嵌 HTTP server（REST API），資料源 CRUD、即時統計、立即觸發檢查
- React UI（Vite）：資料源列表、新增 / 編輯表單、URL 驗證、啟停切換
- 資料源設定從 `settings.json` 移入 SQLite，透過 UI 管理，無需手動編輯設定檔
- Electron 整合：single-instance lock、二次啟動自動開啟瀏覽器

### Phase 3 — 擷取內容的檢視介面（已完成）

> 詳見 [doc/Phase3_ContentFeed_設計文件.md](doc/Phase3_ContentFeed_設計文件.md)

- 三欄閱讀介面：左欄資料源導航（含未讀計數）、中欄卡片列表（可拖拽調整寬度）、右欄 Markdown 摘要渲染
- 無限滾動：捲動至底部自動載入更多，Intersection Observer 實現
- 未讀追蹤：點擊卡片自動標記已讀，支援「標記為未讀」還原；未讀計數即時同步
- 主題系統：深色 / 淺色模式 + 三段字體大小，CSS 變數 + localStorage 持久化
- 內容篩選：點擊左欄資料源僅顯示該資料源的內容

### Phase 4 — LLM以及其他參數設定介面（已完成）

> 詳見 [doc/Phase4_Settings_設計文件.md](doc/Phase4_Settings_設計文件.md)

- LLM 設定從 `settings.json` 遷移至 DB（`app_settings` table）
- Settings UI：Provider 選擇、API Key 驗證、模型選單、參數配置
- 未設定 LLM 時顯示橘色警示 banner，導向 Settings 頁面
- 支援 OpenAI、Gemini、OpenAI-compatible 三種 provider

### Phase 5 — 下載與摘要分離架構（已完成）

> 詳見 [doc/Phase5_下載與摘要分離_設計文件.md](doc/Phase5_下載與摘要分離_設計文件.md)

- 下載與 LLM 摘要拆分為兩個獨立 Pipeline：DownloadQueue → LLMQueue
- 狀態流程：`new` → `fetched`（下載完成）→ `summarized`（LLM 完成）；向後相容舊 `processed` 狀態
- 重啟自動續跑：啟動時掃描 `status='fetched'` 項目，重新加入 LLM queue
- LLM Queue 單執行緒 + Sliding window rate limiting，支援 `requestsPerMinute` 設定
- LLM 呼叫獨立日誌（`logs/llm.log`）：記錄每次呼叫的 provider、model、token 數、耗時

### Phase 6 — 安裝程式與自動更新（規劃中）

> 詳見 [doc/Phase6_安裝程式與自動更新_設計文件.md](doc/Phase6_安裝程式與自動更新_設計文件.md)

- 建構 Mac / Windows installer，發佈至 GitHub Releases
- Windows：安裝後建立桌面捷徑，點擊自動開啟設定畫面
- Mac：首次執行時自動開啟設定畫面
- 內建自動更新機制：啟動時檢查 GitHub Releases 是否有新版本，有則提示更新流程

## 環境需求

- Node.js >= 20
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)（YouTube 字幕下載）

### macOS

```bash
# yt-dlp
brew install yt-dlp
```

### Windows

```bash
# yt-dlp — 從 GitHub Releases 下載 yt-dlp.exe 並加入 PATH
# https://github.com/yt-dlp/yt-dlp/releases
```

> **Console 中文顯示**：Windows 預設 terminal codepage 可能導致中文 log 亂碼。
> 建議使用 [Windows Terminal](https://aka.ms/terminal)（預設 UTF-8），或在啟動前執行 `chcp 65001`。
> Log 檔案（`logs/app.log`）不受影響，始終為 UTF-8。

> **如果安裝或 rebuild 時出現編譯錯誤**：`better-sqlite3` 提供 pre-built binary，
> 大多數情況不需要編譯工具。若遇到錯誤，可安裝 Windows Build Tools：
> ```
> # 以系統管理員身分執行 PowerShell
> npm install --global windows-build-tools
> ```
> 或在安裝 Node.js 時勾選「Automatically install the necessary tools」。

### Linux

```bash
# yt-dlp
pip install yt-dlp
```

> **如果安裝或 rebuild 時出現編譯錯誤**：
> ```bash
> sudo apt install build-essential python3   # Debian/Ubuntu
> ```

## 安裝

```bash
git clone <repo-url>
cd XQDigest
npm install
```

## 設定

### 設定檔（選填）

如需自訂技術參數，可複製範例設定檔：

```bash
cp config/settings.json.example config/settings.json
```

編輯 `config/settings.json` 可調整：
- **app.logLevel**: 日誌等級（`debug` / `info` / `warn` / `error`）
- **app.dataPath**: 資料儲存路徑（預設 `./data`）
- **app.apiPort**: API server 埠號（預設 `3579`）
- **download**: 下載佇列參數（並發數、重試次數等）
- **llm**: 產生摘要佇列參數（重試次數、每分鐘下載次數限制等）

設定檔欄位詳見 `config/settings.json.example`。

### UI 管理（必須）

1. **啟動應用**（CLI 或 Electron 模式）
2. **開啟 Settings 頁面**：
   - CLI 模式：瀏覽器訪問 `http://localhost:3579/settings`
   - Electron 模式：系統匣右鍵 → Settings
3. **配置 LLM**：
   - 選擇 Provider（OpenAI / Gemini / OpenAI-compatible）
   - 輸入 API Key 並驗證
   - 選擇模型與參數
4. **新增資料源**：點擊「新增資料源」添加 YouTube 頻道或 RSS Feed

設定將自動儲存至資料庫，重啟後持續生效。

## 執行

### 開發模式選擇

| 模式 | 指令 | 用途 |
|------|------|------|
| **CLI 模式** | `npm start` | 快速測試核心邏輯（無 UI hot-reload） |
| **Electron 桌面模式** | `npm run electron:start` | 正式使用、測試桌面整合 |
| **React UI 開發模式** | `npm start` + `npm run renderer:dev` | 修改 React 程式碼時使用（HMR） |

---

### 1. CLI 模式

```bash
npm start
```

**說明**：
- 啟動純 Node.js 模式（無 Electron tray）
- 自動 rebuild `better-sqlite3` for Node.js ABI
- API server 在 `:3579`，可用瀏覽器開啟 `http://localhost:3579` 管理資料源
- 按 `Ctrl+C` 停止

**適合**：快速測試核心邏輯、除錯 scheduler、測試 LLM 摘要

---

### 2. Electron 桌面模式（正常使用）

```bash
npm run electron:start
```

**說明**：
- 依序執行 `renderer:build` → `electron:rebuild` → `electron`
- **重要**：自動 rebuild `better-sqlite3` for Electron ABI（強制覆蓋）
- 啟動後常駐於系統匣（macOS menu bar / Windows 工作列）

**右鍵選單**：
- **Settings** — 在瀏覽器開啟 `http://localhost:3579/#/settings`（管理 UI）
- **Feeds** - 在瀏覽器開啟 `http://localhost:3579/#/feed`（檢視擷取資料 UI）
- **Pause / Resume** — 控制排程（API server 繼續運作）
- **Quit** — 結束應用

**注意**：
- UI 是 build 出的靜態檔案（無 hot-reload）
- 修改 React 程式碼後須重新執行 `npm run renderer:build`，或改用「React UI 開發模式」

---

### 3. React UI 開發模式（Hot-reload）

適合**修改 React UI 程式碼**時使用，需要兩個 terminal：

```bash
# Terminal 1：啟動後端 API server
npm start                    # Node.js backend on :3579

# Terminal 2：啟動 Vite dev server（hot-reload）
npm run renderer:dev         # Vite dev server on :5173
```

**瀏覽器**：開啟 `http://localhost:5173`

**說明**：
- Terminal 1 提供 API，Terminal 2 提供 React hot-reload
- `/api/*` 請求由 Vite 自動 proxy 到 `:3579`
- 修改 React 程式碼 → 瀏覽器立即更新（HMR）
- 修改 Node.js 程式碼（`src/`）→ 重啟 Terminal 1

---

## 開發流程常見問題

### ❌ 錯誤：NODE_MODULE_VERSION mismatch

```
Error: The module '/path/to/better_sqlite3.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 127. This version requires NODE_MODULE_VERSION 143.
```

**原因**：在 CLI 模式和 Electron 模式之間切換時，`better-sqlite3` native module 的 ABI 版本不匹配。

**解決方式**：

```bash
# 方法 1：使用正確的啟動指令（自動 rebuild）
npm run electron:start     # Electron 模式（會自動 rebuild）
npm start                  # CLI 模式（會自動 rebuild）

# 方法 2：手動 rebuild（僅在啟動指令失敗時使用）
npm run electron:rebuild   # 切到 Electron ABI
npm run node:rebuild       # 切到 Node.js ABI

# 方法 3：清除 build cache 後重新安裝（最終手段）
npm run rebuild:clean      # 一鍵清除 + rebuild for Electron
```

**預防措施**：
- **不要混用** `node src/index.js` 和 `npm run electron` 跳過 rebuild 的指令
- 切換模式時一律使用 `npm start` 或 `npm run electron:start`（會自動 rebuild）

---

### 關於 Native Module Rebuild

`better-sqlite3` 是 native Node.js addon，編譯時會綁定特定的 **ABI（Application Binary Interface）版本**。Node.js 與 Electron 各自有自己的 ABI，同一份編譯結果無法跨環境使用。

| 環境 | ABI 範例 | Rebuild 指令 |
|------|---------|-------------|
| Node.js v20.x | MODULE_VERSION 127 | `npm run node:rebuild` |
| Electron v40.x | MODULE_VERSION 143 | `npm run electron:rebuild` |

**自動 Rebuild**：
- `npm start` → 自動執行 `node:rebuild`
- `npm run electron:start` → 自動執行 `electron:rebuild`
- `npm test` → 自動執行 `node:rebuild`

**何時需要手動 Rebuild？**
- ✅ 升級 Node.js 版本後 → `npm run node:rebuild`
- ✅ 升級 Electron 版本後 → `npm run electron:rebuild`
- ✅ 執行時出現 `NODE_MODULE_VERSION mismatch` 錯誤
- ✅ 刪除 `node_modules` 重新安裝後

**驗證 Rebuild 成功**：

```bash
# 驗證當前 better-sqlite3 是為哪個環境 build 的
file node_modules/better-sqlite3/build/Release/better_sqlite3.node

# macOS 範例輸出
# Mach-O 64-bit dynamically linked shared library arm64  ← 正確
```

如果啟動時仍出現 MODULE_VERSION mismatch，執行：
```bash
npm run rebuild:clean  # 清除 build cache + rebuild for Electron
```

**快速啟動（跳過 Rebuild）**：

僅在**確定** native module 已是正確 ABI 時使用（例如剛 rebuild 過）：

```bash
# CLI 模式跳過 rebuild
node src/index.js

# Electron 模式跳過 rebuild（需先確保已執行過 electron:rebuild）
npm run electron
```

## 測試

```bash
# 單元測試（tests/test-*.js）
npm test

# 整合測試（tests/integration-*.js，部分需要網路）
npm run test:integration

# 執行單一測試檔
node --test tests/test-config.js
```

整合測試部分項目需要實際網路連線（例如呼叫 YouTube），建議在穩定網路環境下執行。

## 發佈安裝程式

### 更版流程

**版本號的唯一來源是 `package.json` 的 `"version"` 欄位。**

```bash
npm version patch   # 0.2.0 → 0.2.1
npm version minor   # 0.2.0 → 0.3.0
npm version major   # 0.2.0 → 1.0.0
```

`npm version` 會自動修改 `package.json`、建立 git commit 與 tag。版本號會自動反映在 Settings 頁面右上角及 installer 檔名。

---

### Mac Build（在 macOS 上執行）

```bash
# 1. 下載 yt-dlp binary（首次或需要更新時）
npm run download:yt-dlp mac

# 2. Build installer
npm run build:mac

# 輸出：dist/XQDigest-x.y.z.dmg
```

> **未簽名 app**：首次開啟需手動允許（系統設定 → 隱私權與安全性）；
> 或執行 `xattr -dr com.apple.quarantine /Applications/XQDigest.app`。

---

### Windows Build（必須在 Windows 上執行）

```bash
# 1. 下載 yt-dlp binary（首次或需要更新時）
npm run download:yt-dlp win

# 2. Build installer
npm run build:win

# 輸出：dist\XQDigest Setup x.y.z.exe
```

> **未簽名 exe**：可能觸發 SmartScreen 警告，點擊「更多資訊 → 仍要執行」即可。

---

### 發佈到 GitHub Releases

```bash
# 1. 確認測試全過
npm test

# 2. 更版（會自動建立 git tag）
npm version minor

# 3. 推送 tag
git push && git push --tags

# 4. 在 GitHub 建立 Release（對應 tag），上傳 dist/ 中的安裝檔
#    Mac：dist/XQDigest-x.y.z.dmg
#    Win：dist/XQDigest Setup x.y.z.exe
```

## 專案結構

```
src/
├── app-engine.js         # 應用引擎（狀態機 + 模組協調）
├── api-server.js         # 內嵌 HTTP server（API + 靜態檔）
├── api-routes.js         # REST API route handlers
├── datasource-manager.js # 資料源 CRUD（SQLite 封裝）
├── index.js              # CLI 入口
├── config.js             # 設定管理
├── logger.js             # Logger (singleton)
├── queue.js              # 下載佇列（並發控制 + 重試）
├── llm-queue.js          # LLM 摘要佇列（單執行緒 + rate limiting）
├── llm-logger.js         # LLM 呼叫日誌（logs/llm.log）
├── scheduler.js          # 排程與處理 pipeline
├── storage.js            # Markdown + SQLite 雙寫
├── database/
│   ├── db.js             # SQLite 操作
│   └── schema.sql
├── fetchers/
│   ├── youtube.js        # YouTube 頻道掃描 + yt-dlp 字幕
│   └── rss.js            # RSS/Atom Feed 解析
└── llm/
    ├── base.js           # LLM Provider 基底類別
    ├── index.js          # LLM 統一入口
    ├── openai.js         # OpenAI / OpenAI-compatible
    └── gemini.js         # Google Gemini

electron/
├── main.js               # Electron main process
├── tray.js               # 系統匣管理（TrayManager）
└── icons/
    ├── iconTemplate.png   # macOS template image（16x16）
    ├── iconTemplate@2x.png # macOS Retina
    └── icon-win.png       # Windows/Linux（32x32）

renderer/
└── src/                  # React UI（Vite + React）
```

## 文件

- `doc/Phase0_模組設計文件.md` — Phase 0 模組架構、介面、資料流程
- `doc/Phase1_Electron整合設計文件.md` — Phase 1 AppEngine 與 Electron 整合設計
- `doc/Phase2_DataSources_UI設計文件.md` — Phase 2 HTTP Server、REST API、React UI 設計、DataSource管理UI
- `doc/Phase3_ContentFeed_設計文件.md` — Phase 3 Feed 閱讀介面、Content API、主題系統設計
- `doc/Phase4_Settings_設計文件.md` — Phase 4 完整的設定UI，整合LLM的設定以及DataSource的管理
- `doc/Phase5_下載與摘要分離_設計文件.md` — Phase 5 雙 Pipeline 架構、LLMQueue、LLMLogger、狀態流程設計
- `doc/Phase6_安裝程式與自動更新_設計文件.md` — Phase 6 Installer 打包、路徑設計、版號顯示、首次執行、自動更新
- `CLAUDE.md` — AI 開發規範與架構導覽
