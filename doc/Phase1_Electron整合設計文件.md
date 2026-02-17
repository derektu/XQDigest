# XQDigest Phase 1 — Electron 整合設計文件

> 本文件記錄 Phase 1 的架構設計：AppEngine 抽離、Electron 桌面整合、跨平台處理。
> 適用版本：v0.2.0

---

## 1. Phase 概覽

| Phase | 名稱 | 狀態 | 說明 |
|-------|------|------|------|
| Phase 0 | POC | 已完成 | 純 CLI，驗證核心流程（fetcher → LLM → storage） |
| Phase 1 | Electron 框架整合 | 已完成 | AppEngine + tray，雙模式啟動 |
| Phase 2 | UI 功能建置 | 下一階段 | 設定畫面、內容瀏覽、狀態儀表板等 |

### Phase 1 目標

1. 將 `index.js` 的模組初始化與生命週期邏輯抽離為 `AppEngine` class
2. 整合 Electron，以系統匣（tray）常駐方式運行
3. CLI 與 Electron 共用同一個 AppEngine，避免重複邏輯
4. 處理 native module（better-sqlite3）在 Electron 環境的 rebuild

---

## 2. 架構概觀

```
┌─────────────────────────────────────────────────────────┐
│                     啟動入口                              │
│                                                         │
│   src/index.js (CLI)          electron/main.js (桌面)    │
│       │                           │                     │
│       └──────────┬────────────────┘                     │
│                  │                                      │
│           ┌──────▼──────┐                               │
│           │  AppEngine  │  ← 狀態機 + 模組協調           │
│           │  (EventEmitter)                             │
│           └──────┬──────┘                               │
│                  │                                      │
│    ┌─────────────┼─────────────┐                        │
│    │             │             │                        │
│  ConfigManager  Logger    Scheduler                     │
│  DB, Storage    Queue     Fetchers, LLM                 │
└─────────────────────────────────────────────────────────┘

Electron 專屬：
┌─────────────────────┐
│   TrayManager       │  ← 監聽 AppEngine stateChange
│   (系統匣選單)       │     更新選單啟用/停用狀態
└─────────────────────┘
```

---

## 3. AppEngine (`src/app-engine.js`)

### 3.1 職責

封裝所有核心模組的初始化、啟動、停止與生命週期管理。取代原本散落在 `index.js` 中的邏輯，讓 CLI 和 Electron 都能透過同一介面操作。

### 3.2 狀態機

```
stopped ──start()──▶ starting ──(初始化完成)──▶ running
                                                  │
running ──stop()───▶ stopping ──(清理完成)───▶ stopped
                                                  │
running ──restart()──▶ stop() → start() ──▶ running
```

**狀態定義**:

| 狀態 | 說明 |
|------|------|
| `stopped` | 未啟動，所有資源已釋放 |
| `starting` | 正在初始化模組 |
| `running` | 正常運行中，排程器已啟動 |
| `stopping` | 正在關閉資源 |

### 3.3 繼承

`EventEmitter`

### 3.4 Constructor

```javascript
new AppEngine(options?)
// options.configPath: 設定檔路徑（預設為 config/settings.json）
```

### 3.5 公開方法

| 方法 | 回傳 | 說明 |
|------|------|------|
| `getState()` | `string` | 回傳目前狀態 |
| `getStatus()` | `Object` | 回傳 `{ state, dataSources, llmConfigured }` |
| `start()` | `Promise<void>` | 初始化所有模組並啟動排程 |
| `stop()` | `Promise<void>` | 停止排程、關閉 DB、釋放資源 |
| `restart()` | `Promise<void>` | 依序 stop → start，並觸發 configReloaded 事件 |

### 3.6 事件

| 事件 | 參數 | 說明 |
|------|------|------|
| `stateChange` | `(newState, oldState)` | 狀態轉換時觸發 |
| `error` | `(Error)` | 發生錯誤時觸發 |
| `configReloaded` | 無 | 設定檔重新載入完成 |

### 3.7 start() 初始化流程

```
1.  載入設定檔 (ConfigManager.load)
2.  初始化 Logger singleton
3.  開啟 SQLite 資料庫
4.  建立 Storage 實例
5.  建立 DownloadQueue 實例
6.  建立 YouTubeFetcher / RSSFetcher 實例
7.  建立 LLMService 實例（若有 API Key）
8.  建立 Scheduler 實例
9.  啟動設定檔監聽（熱 reload）
10. 啟動排程器
```

### 3.8 stop() 清理流程

```
1.  停止 Scheduler
2.  停止設定檔監聽、移除事件監聽器
3.  關閉 SQLite 連線
4.  關閉 Logger
5.  將所有模組參照設為 null
```

### 3.9 設定檔熱 Reload

AppEngine 內建設定檔監聽，變更時自動：
- 更新 Logger 等級
- 更新 DownloadQueue 並發上限
- 更新 LLMService provider/model
- 重啟 Scheduler（套用新資料源設定）

---

## 4. CLI 入口 (`src/index.js`)

精簡為薄 wrapper：

```javascript
const engine = new AppEngine();
process.on('SIGINT', () => engine.stop().then(() => process.exit(0)));
process.on('SIGTERM', () => engine.stop().then(() => process.exit(0)));
await engine.start();
```

---

## 5. Electron 整合

### 5.1 入口 (`electron/main.js`)

| 步驟 | 說明 |
|------|------|
| 1 | `app.disableHardwareAcceleration()` — tray-only 不需 GPU |
| 2 | `app.requestSingleInstanceLock()` — 防止多開 |
| 3 | `app.on('ready')` — 建立 AppEngine + TrayManager |
| 4 | macOS: `app.dock.hide()` — 隱藏 Dock 圖示（純 tray 模式） |
| 5 | 監聽 `stateChange` 事件更新 tray 選單 |
| 6 | `app.on('before-quit')` — graceful shutdown |

### 5.2 TrayManager (`electron/tray.js`)

**職責**: 管理系統匣圖示與右鍵選單，反映 AppEngine 狀態。

**Constructor**:
```javascript
new TrayManager(engine)
// engine: AppEngine 實例
```

**公開方法**:

| 方法 | 說明 |
|------|------|
| `updateState(state)` | 更新內部狀態，重建選單 |
| `destroy()` | 銷毀 tray 圖示 |

**選單項目**:

| 項目 | 條件 |
|------|------|
| Start | `state === 'stopped'` 時啟用 |
| Stop | `state === 'running'` 時啟用 |
| Restart | `state === 'running'` 時啟用 |
| Status: {state} | 顯示目前狀態（唯讀） |
| Quit | 永遠啟用 |

### 5.3 跨平台 Icon 處理

| 平台 | 圖示檔 | 處理方式 |
|------|--------|----------|
| macOS | `iconTemplate.png` / `iconTemplate@2x.png` | `setTemplateImage(true)` — 系統自動適配深色/淺色選單列 |
| Windows/Linux | `icon-win.png` (32x32) | 直接使用，白色圖示適用深色工作列 |

**`_getIconPath()` 邏輯**:
```javascript
if (process.platform === 'darwin') {
  return 'iconTemplate.png';   // macOS template image 機制
} else {
  return 'icon-win.png';       // Windows/Linux 一般圖示
}
```

macOS 額外處理：resize 為 16x16 並設定 `setTemplateImage(true)`，讓系統根據選單列主題自動調整顏色。

---

## 6. Native Module 處理

### 6.1 問題

`better-sqlite3` 包含 native C++ addon，需要與 Electron 使用的 Node.js ABI 版本匹配。直接 `npm install` 編譯的版本是給系統 Node.js 用的，Electron 啟動時會報 ABI mismatch 錯誤。

### 6.2 解法

使用 `@electron/rebuild` 重新編譯 native module：

```bash
npm run electron:rebuild    # 只 rebuild
npm run electron:start      # rebuild + 啟動
```

**package.json scripts**:
```json
{
  "electron:rebuild": "electron-rebuild -f -w better-sqlite3",
  "electron:start": "npm run electron:rebuild && electron ."
}
```

### 6.3 注意事項

- rebuild 後 `better-sqlite3` 只能在 Electron 中使用，CLI 模式需要重新 `npm install`
- 開發中頻繁切換模式時，可以只跑 `npm run electron`（跳過 rebuild），前提是已經 rebuild 過
- `@electron/rebuild` 和 `electron` 都列在 `devDependencies`

---

## 7. 雙模式啟動流程

```
                    npm start
                        │
                        ▼
                  src/index.js
                        │
                  AppEngine.start()
                        │
              ┌─────────▼──────────┐
              │ 核心模組初始化       │
              │ Config → Logger →  │
              │ DB → Storage →     │
              │ Queue → Fetchers → │
              │ LLM → Scheduler    │
              └─────────┬──────────┘
                        │
                  Scheduler.start()
                        │
              等待 SIGINT/SIGTERM


              npm run electron:start
                        │
                  electron-rebuild
                        │
                  electron/main.js
                        │
              ┌─────────▼──────────┐
              │ app.ready           │
              │  → AppEngine()     │
              │  → TrayManager()   │
              │  → engine.start()  │
              └─────────┬──────────┘
                        │
              系統匣常駐，選單操作
                        │
              app.before-quit
                        │
              engine.stop() → app.quit()
```

---

## 8. 與 Phase 0 的差異

| 面向 | Phase 0 | Phase 1 |
|------|---------|---------|
| 入口 | `src/index.js` 直接初始化所有模組 | `AppEngine` 封裝，index.js 只是薄 wrapper |
| 啟動模式 | CLI only | CLI + Electron tray |
| 生命週期 | SIGINT/SIGTERM → 手動清理 | AppEngine 狀態機管理 |
| 模組初始化 | 分散在 index.js | 集中在 AppEngine.start() |
| 設定監聽 | index.js 內建 | AppEngine._setupConfigListeners() |
| 新增依賴 | 無 | electron, @electron/rebuild (devDependencies) |
| 新增檔案 | 無 | `src/app-engine.js`, `electron/main.js`, `electron/tray.js`, `electron/icons/*` |

---

## 9. 檔案結構（Phase 1 新增部分）

```
XQDigest/
├── src/
│   ├── app-engine.js          ← 新增：應用引擎
│   └── index.js               ← 修改：改用 AppEngine
├── electron/
│   ├── main.js                ← 新增：Electron 入口
│   ├── tray.js                ← 新增：系統匣管理
│   └── icons/
│       ├── iconTemplate.png   ← 新增：macOS 圖示 (16x16)
│       ├── iconTemplate@2x.png ← 新增：macOS Retina (32x32)
│       └── icon-win.png       ← 新增：Windows/Linux 圖示 (32x32)
├── tests/
│   └── test-app-engine.js     ← 新增：AppEngine 測試
└── package.json               ← 修改：新增 electron scripts + devDependencies
```
