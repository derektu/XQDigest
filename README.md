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

### Phase 4 — LLM以及其他參數設定介面（尚未完成）

### Phase 5 — Installer以及auto-update機制（尚未完成）

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

複製範例設定檔並填入你的設定：

```bash
cp config/settings.json.example config/settings.json
```

編輯 `config/settings.json`，填入：

- **llm.apiKey**: OpenAI 或 Gemini 的 API Key
- **llm.provider**: `"openai"` / `"openai-compatible"` / `"gemini"`

資料源（YouTube 頻道 / RSS Feed）透過 UI 管理，無需手動編輯設定檔。

設定檔欄位詳見 `config/settings.json.example` 和 `doc/Phase0_模組設計文件.md`。

## 執行

### CLI 模式

```bash
npm start
```

啟動純 Node.js 模式（無 Electron tray，無 React UI hot-reload）。API server 在 `:3579`，
可用瀏覽器開啟 `http://localhost:3579` 管理資料源（UI 為靜態 build）。按 `Ctrl+C` 停止。

### Electron 桌面模式（正常使用）

```bash
npm run electron:start
```

依序執行 `renderer:build` → `electron:rebuild` → `electron`，完整啟動桌面應用。
啟動後常駐於系統匣（macOS menu bar / Windows 工作列），透過右鍵選單控制：

- **Settings** — 在瀏覽器開啟 `http://localhost:3579`（DataSources 管理 UI）
- **Pause** — 暫停排程（API server 繼續運作，可繼續使用 UI）
- **Resume** — 繼續排程
- **Quit** — 結束應用

> **注意**：`:5173` port 不會啟動；`:3579` serve 的是 build 出的靜態 UI。
> 修改 React 程式碼後須重新執行 `npm run renderer:build` 才能反映，或改用下方「React UI 開發模式」。

### React UI 開發模式（Hot-reload）

適合**修改 React UI 程式碼**時使用，需要兩個 terminal：

```bash
# Terminal 1：啟動後端 API server
npm start                    # Node.js backend，API server on :3579

# Terminal 2：啟動 Vite dev server（hot-reload）
npm run renderer:dev         # Vite dev server on :5173，proxy /api → :3579

# 瀏覽器開啟
http://localhost:5173        # React UI，修改程式碼後自動更新（HMR）
```

- Terminal 1 提供 API，Terminal 2 提供 React hot-reload
- `/api/*` 請求由 Vite 自動 proxy 到 `:3579`
- 修改 React 程式碼 → 瀏覽器立即更新
- 修改 Node.js 程式碼（`src/`）→ 重啟 Terminal 1

### 關於 rebuild

`better-sqlite3` 是 native Node.js addon，編譯時會綁定特定的 **ABI（Application Binary Interface）版本**。
Node.js 與 Electron 各自有自己的 ABI，同一份編譯結果無法跨環境使用：

| 環境 | rebuild 指令 | 說明 |
|------|-------------|------|
| Node.js（CLI / 測試） | `npm run node:rebuild` | `npm rebuild better-sqlite3`，編譯成 Node.js ABI |
| Electron（桌面模式） | `npm run electron:rebuild` | `@electron/rebuild`，編譯成 Electron ABI |

`npm start` 和 `npm test` 會自動執行 `node:rebuild`；`npm run electron:start` 會自動執行 `electron:rebuild`。

**何時需要手動執行 rebuild？**

- 升級 Node.js 版本後，執行 `npm run node:rebuild`
- 升級 Electron 版本後，執行 `npm run electron:rebuild`
- 執行時出現 `NODE_MODULE_VERSION mismatch` 或 `was compiled against a different Node.js version` 錯誤

**跳過 rebuild 快速啟動**

若確定 native module 已是正確 ABI（例如剛 rebuild 過），可跳過加速啟動：

```bash
# CLI 模式跳過 rebuild
node src/index.js

# Electron 模式跳過 rebuild（native module 已是 Electron ABI）
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
- `doc/Phase2_DataSources_UI設計文件.md` — Phase 2 HTTP Server、REST API、React UI 設計
- `doc/Phase3_ContentFeed_設計文件.md` — Phase 3 Feed 閱讀介面、Content API、主題系統設計
- `CLAUDE.md` — AI 開發規範與架構導覽
