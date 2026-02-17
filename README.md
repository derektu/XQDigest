# XQDigest

財經資訊自動摘要工具。自動監控 YouTube 頻道與 RSS Feed，下載內容並透過 LLM 產生摘要。

## 目前狀態

**Phase 1 (Electron 整合)** — 已完成桌面應用框架：

- 定時掃描 YouTube 頻道 / RSS Feed，取得最新內容
- YouTube 影片透過 yt-dlp 下載字幕（支援多語言優先序）
- 呼叫 LLM（OpenAI / Gemini）產生摘要
- 原始內容與摘要儲存為 Markdown 檔案 + SQLite 記錄
- 設定檔熱 reload、下載佇列並發控制與自動重試
- **Electron 桌面模式**：系統匣（tray）常駐，選單控制 Start/Stop/Restart
- **AppEngine 架構**：狀態機管理引擎生命週期，CLI 與 Electron 共用核心
- **跨平台圖示**：macOS template image + Windows/Linux 白色圖示

## 環境需求

- Node.js >= 20
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)（YouTube 字幕下載）
- C/C++ 編譯工具（`better-sqlite3` 為 native module，需要編譯）

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

### Linux

```bash
# Debian/Ubuntu
sudo apt install build-essential python3

# yt-dlp
pip install yt-dlp
```

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

編輯 `config/settings.json`：

- **dataSources**: 加入你要監控的 YouTube 頻道或 RSS Feed
- **llm.apiKey**: 填入 OpenAI 或 Gemini 的 API Key
- **llm.provider**: `"openai"` / `"openai-compatible"` / `"gemini"`

設定檔欄位詳見 `config/settings.json.example` 和 `doc/Phase0_模組設計文件.md`。

## 執行

### CLI 模式

```bash
npm start
```

啟動後會依各資料源的 `checkInterval` 定時檢查。按 `Ctrl+C` 停止。

### Electron 桌面模式

```bash
npm run electron:start
```

> **注意：CLI 與 Electron 模式使用不同的 Node ABI。**
> `npm start` 和 `npm run electron:start` 會自動 rebuild native module（`better-sqlite3`）至對應的 ABI，可以自由切換。
> 如果確定 native module 已經是正確的 ABI，可用 `node src/index.js` 或 `npm run electron` 跳過 rebuild 加速啟動。

啟動後會常駐於系統匣（macOS menu bar / Windows 工作列），透過右鍵選單控制：

- **Start** — 啟動引擎
- **Stop** — 停止引擎
- **Restart** — 重新啟動（含重新載入設定）
- **Quit** — 結束應用

## 測試

```bash
npm test
```

## 專案結構

```
src/
├── app-engine.js         # 應用引擎（狀態機 + 模組協調）
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
```

## 文件

- `doc/Phase0_模組設計文件.md` — Phase 0 模組架構、介面、資料流程
- `doc/Phase1_Electron整合設計文件.md` — Phase 1 AppEngine 與 Electron 整合設計
- `CLAUDE.md` — AI 開發規範與架構導覽
