# XQDigest - Claude Code 開發規範

## 專案概述

XQDigest 是財經資訊自動摘要工具。自動監控 YouTube 頻道與 RSS Feed，下載內容並透過 LLM 產生摘要。

- **Phase 0 (POC)**: 純 CLI 驗證核心流程 — 已完成
- **Phase 1**: Electron 框架整合（AppEngine + tray）— 已完成
- **Phase 2**: UI 功能逐步建置 — 下一階段

純 Node.js (CommonJS) 專案，Electron 作為桌面外殼。

## 架構導覽

理解系統的關鍵文件（建議閱讀順序）：

| 文件 | 說明 |
|------|------|
| `doc/Phase0_模組設計文件.md` | 核心模組架構、介面、資料流程（完整參考） |
| `doc/Phase1_Electron整合設計文件.md` | AppEngine 狀態機、Electron 整合、跨平台處理 |
| `src/app-engine.js` | 應用核心引擎，封裝所有模組初始化與生命週期 |
| `src/index.js` | CLI 模式入口（透過 AppEngine） |
| `electron/main.js` | Electron 入口（AppEngine + TrayManager） |
| `electron/tray.js` | 系統匣管理（macOS/Windows 跨平台 icon） |
| `config/settings.json.example` | 設定檔格式參考 |

## 專案結構

```
src/                  — 核心模組（純 Node.js，無 Electron 依賴）
  ├── app-engine.js   — 應用引擎（狀態機 + 模組協調）
  ├── index.js        — CLI 入口
  ├── config.js       — 設定管理
  ├── logger.js       — Logger (singleton)
  ├── queue.js        — 下載佇列（並發控制 + 重試）
  ├── scheduler.js    — 排程與處理 pipeline
  ├── storage.js      — Markdown + SQLite 雙寫
  ├── database/       — SQLite 操作
  ├── fetchers/       — YouTube / RSS 資料抓取
  └── llm/            — LLM provider（OpenAI / Gemini）
electron/             — Electron 桌面外殼
  ├── main.js         — Electron main process
  ├── tray.js         — 系統匣管理
  └── icons/          — 平台圖示
tests/                — 測試程式
config/               — 設定檔
doc/                  — 設計文件
data/                 — 運行時資料 (git ignored)
logs/                 — 日誌 (git ignored)
```

## 測試規範

### 測試框架
- 使用 Node.js 內建 `node:test` 模組
- 斷言使用 `node:assert/strict`
- 不依賴外部測試框架

### 必須遵守的規則
- **任何模組的新增或修改，都必須同步新增或更新對應的測試檔案**
- 測試檔案位於 `tests/` 目錄，命名格式為 `test-{模組名稱}.js`
- 完成修改後執行 `npm test` 確認全部通過

### 測試執行方式
```bash
npm test                            # 執行所有測試（自動掃描 tests/test-*.js）
node --test tests/test-config.js    # 執行單一模組測試
```

### 修改程式碼時的 checklist
1. 修改模組 → 更新對應的 `tests/test-{模組}.js`
2. 新增模組 → 建立對應的測試檔案
3. 修改設定檔格式 → 更新 `tests/test-config.js`
4. 修改資料庫 schema → 更新 `tests/test-db.js` 和 `tests/test-storage.js`

### 測試慣例

- **命名**: 用中文描述行為，格式 `{方法名}() {應/不應}{做什麼}`
- **暫存目錄**: 放在 `tests/` 下，使用 `_tmp_` 前綴，在 `before`/`after` 中建立與清除
- **Mock**: 用簡單物件 mock（依賴注入），不需 mock 框架
- **網路測試**: 用 try/catch 包裹，網路不可用時 graceful 跳過
- **參考範例**: 直接查看 `tests/` 下的現有測試檔案
