# Phase 6 — 安裝程式與自動更新 設計文件

## 1. 概述

Phase 6 三大方向：

1. **Installer 打包**：以 electron-builder 建構 macOS DMG 與 Windows NSIS 安裝程式，並隨包捆綁 yt-dlp binary。
2. **首次執行體驗**：安裝後首次啟動自動開啟 Settings 頁面，引導用戶完成 LLM 設定。
3. **自動更新**：透過 electron-updater 在啟動時檢查 GitHub Releases 是否有新版本，並提供 Tray 手動觸發入口。

---

## 2. Packaged App 環境差異

在開發模式（`npm run electron:start`）與打包後（DMG / NSIS installer）兩種環境下，關鍵路徑有所不同：

| 資源 | 開發模式 | Packaged App |
|------|----------|--------------|
| yt-dlp binary | 系統 PATH（`yt-dlp`） | `process.resourcesPath/bin/yt-dlp[.exe]` |
| 設定檔 (`settings.json`) | `config/settings.json` | `{userData}/settings.json` |
| 資料目錄 (`data/`) | `./data/` | `{userData}/` |
| 日誌目錄 (`logs/`) | `./logs/` | `{userData}/logs/` |
| React 靜態檔案 | `dist-renderer/` | `dist-renderer/`（隨 app 打包） |

### 路徑解析機制

**yt-dlp 路徑**（`src/app-engine.js` `resolveYtDlpBin()`）：

```javascript
function resolveYtDlpBin() {
  if (process.resourcesPath) {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const bundled = path.join(process.resourcesPath, 'bin', `yt-dlp${ext}`);
    if (fs.existsSync(bundled)) return bundled;
  }
  return 'yt-dlp'; // 開發模式：使用系統 PATH
}
```

**資料 / 日誌路徑**（`src/config.js` `getDataPath()`）：

```javascript
getDataPath() {
  if (process.env.XQDIGEST_DATA_PATH) {
    return process.env.XQDIGEST_DATA_PATH; // Electron main.js 在啟動時設定
  }
  // 開發模式：相對路徑 ./data
  return path.resolve(path.dirname(this.configPath), '..', dataPath);
}
```

`electron/main.js` 在 `app.on('ready')` 最前面設定：

```javascript
process.env.XQDIGEST_DATA_PATH = app.getPath('userData');
```

這確保 packaged app 的資料與日誌存放在作業系統標準的 userData 目錄（macOS: `~/Library/Application Support/XQDigest`，Windows: `%APPDATA%\XQDigest`）。

---

## 3. 版號取得與顯示

**版號的唯一來源是 `package.json` 的 `"version"` 欄位。**

### 後端：`/api/version`

`src/api-routes.js`：

```javascript
{
  method: 'GET',
  pattern: '/api/version',
  handler: () => {
    const { version } = require('../package.json');
    return { data: { version } };
  },
},
```

### 前端：React 元件

`renderer/src/ipc.js` 提供統一入口：

```javascript
export const app = {
  getVersion: () => _request('GET', '/api/version'),
};
```

顯示位置：

| 位置 | 元件 | 取得方式 |
|------|------|----------|
| SourceNav 左欄 logo 下方 | `renderer/src/components/SourceNav.jsx` | `appIpc.getVersion()` → `useState` |
| Settings 頁面右上角 | `renderer/src/pages/SettingsPage.jsx` | `app.getVersion()` → `useState` |

SourceNav 範例：

```jsx
const [version, setVersion] = useState(null);
useEffect(() => {
  appIpc.getVersion().then(r => setVersion(r.version)).catch(() => {});
}, []);

// 在 logoArea 中：
{version && (
  <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>v{version}</div>
)}
```

### Electron：Tray 選單

`electron/tray.js` 使用 Electron 的 `app.getVersion()`（直接讀取 `package.json`，無需 HTTP）：

```javascript
{ label: `XQDigest v${app.getVersion()}`, enabled: false },
```

---

## 4. Installer 打包

### Build Scripts（`package.json`）

| 指令 | 功能 |
|------|------|
| `npm run download:yt-dlp mac` | 下載 macOS arm64 yt-dlp → `build/bin/mac/yt-dlp` |
| `npm run download:yt-dlp win` | 下載 Windows x64 yt-dlp.exe → `build/bin/win/yt-dlp.exe` |
| `npm run build:mac` | renderer build + electron-builder（macOS DMG） |
| `npm run build:win` | renderer build + electron-builder（Windows NSIS） |

### electron-builder.yml 重點設定

```yaml
appId: com.xqdigest.app
productName: XQDigest

files:
  - electron/**        # Electron main process
  - src/**             # 核心模組
  - dist-renderer/**   # 編譯後的 React UI
  - config/settings.json.example
  - package.json
  - "!tests/**"        # 排除測試
  - "!doc/**"          # 排除文件
  - "!renderer/src/**" # 排除原始碼（已編譯）

mac:
  target: dmg (arm64)
  extraResources:
    - from: build/bin/mac/yt-dlp
      to: bin/yt-dlp      # → process.resourcesPath/bin/yt-dlp

win:
  target: nsis (x64)
  extraResources:
    - from: build/bin/win/yt-dlp.exe
      to: bin/yt-dlp.exe

nsis:
  createDesktopShortcut: true
  createStartMenuShortcut: true

publish:
  provider: github
  owner: derektu
  repo: XQDigest
```

### yt-dlp Bundling 流程

```
scripts/download-yt-dlp.js
  ↓ 下載
build/bin/mac/yt-dlp          (macOS arm64 binary)
build/bin/win/yt-dlp.exe      (Windows x64 binary)
  ↓ electron-builder extraResources
{app.asar}/Resources/bin/yt-dlp[.exe]
  ↓ 執行時 resolveYtDlpBin()
process.resourcesPath + '/bin/yt-dlp'
```

注意：`build/bin/` 目錄已加入 `.gitignore`，需在每次 build 前執行下載指令。

---

## 5. 首次執行體驗

### 機制

以 `{userData}/.firstrun` 檔案作為「首次執行」標記：

- **不存在**：首次執行，開啟 Settings 頁面，並建立標記檔
- **存在**：非首次執行，正常啟動

`electron/main.js`：

```javascript
const firstRunFile = path.join(app.getPath('userData'), '.firstrun');
const isFirstRun = !fs.existsSync(firstRunFile);

engine.on('serverReady', (port) => {
  trayManager.setPort(port);
  if (isFirstRun) {
    fs.writeFileSync(firstRunFile, '');
    shell.openExternal(`http://localhost:${port}/#/settings`);
  }
});
```

### 設計考量

- 使用 `userData` 目錄：隨 app 安裝/解安裝，不影響專案目錄
- 等待 `serverReady` 再開啟瀏覽器：確保 API server 已就緒
- 開啟外部瀏覽器（`shell.openExternal`）：tray-only app 無內建視窗

---

## 6. 自動更新機制

### 使用元件

`electron-updater`（`autoUpdater`）：electron-builder 配套的自動更新函式庫，搭配 GitHub Releases 使用。

### 啟動時自動檢查

```javascript
// 僅在 packaged app（app.isPackaged）中啟動
if (app.isPackaged) {
  autoUpdater.autoDownload = false; // 詢問用戶後才下載
  // ... 設定事件 handlers ...
  setTimeout(() => autoUpdater.checkForUpdates(), 10000); // 延遲 10 秒避免影響啟動
}
```

### 事件流程

```
autoUpdater.checkForUpdates()
  │
  ├─ update-not-available → dialog: 「已是最新版本」
  │
  ├─ update-available(info)
  │     → dialog: 「版本 x.y.z 已發布，是否下載？」
  │          ├─ 下載 → autoUpdater.downloadUpdate()
  │          └─ 稍後 → 不動作
  │
  ├─ update-downloaded
  │     → dialog: 「更新已下載，立即重啟？」
  │          ├─ 立即重啟 → autoUpdater.quitAndInstall()
  │          └─ 稍後 → 不動作
  │
  └─ error → logger.warn（靜默記錄，不打擾用戶）
```

### Tray 手動觸發

`electron/tray.js` 的 `TrayManager` 接受 `onCheckUpdate` callback：

```javascript
class TrayManager {
  constructor(engine, options = {}) {
    this._onCheckUpdate = options.onCheckUpdate || null;
    ...
  }

  _buildMenu() {
    ...
    ...(this._onCheckUpdate ? [
      { label: '檢查更新', click: () => this._onCheckUpdate() },
      { type: 'separator' },
    ] : []),
    { label: 'Quit', click: () => app.quit() },
  }
}
```

`electron/main.js` 傳入 callback（只在 packaged app 啟用）：

```javascript
trayManager = new TrayManager(engine, {
  onCheckUpdate: app.isPackaged
    ? () => autoUpdater.checkForUpdates()
    : null,
});
```

手動觸發與自動觸發共用相同的 event handlers，包含 `update-not-available` 回饋（開發模式不顯示此 dialog，避免誤解）。

---

## 7. 架構決策

| 決策 | 選擇 | 理由 |
|------|------|------|
| yt-dlp 路徑解析 | `resolveYtDlpBin()` 在 AppEngine | 核心模組與 Electron 解耦；CLI 模式也能運作 |
| 資料路徑 | 環境變數 `XQDIGEST_DATA_PATH` | Electron 設定，CLI 使用相對路徑；無需修改 Config 模組介面 |
| 版號來源 | `package.json` 唯一來源 | 避免多處維護；`npm version` 一鍵更版 |
| 首次執行偵測 | `.firstrun` 標記檔 | 簡單可靠；解安裝後重裝可重新觸發 |
| autoDownload | `false`（手動確認） | 財經工具，避免在用戶不知情時下載大檔案 |
| 更新 UI | 系統 `dialog` 而非自製 UI | Tray-only app 無視窗，dialog 最輕量 |
| 「檢查更新」顯示條件 | 僅 `app.isPackaged` | 開發模式無 update server，避免錯誤 dialog |

---

## 8. 模組變更摘要

### 已實作

| 模組 | 變更 |
|------|------|
| `src/api-routes.js` | Bug fix：`require('../package.json')`（修正路徑） |
| `src/app-engine.js` | `resolveYtDlpBin()` 處理 packaged app yt-dlp 路徑 |
| `src/config.js` | `getDataPath()` 支援 `XQDIGEST_DATA_PATH` 環境變數 |
| `electron/main.js` | first-run 偵測、`XQDIGEST_DATA_PATH` 設定、autoUpdater handlers（含 `update-not-available`）、`onCheckUpdate` callback |
| `electron/tray.js` | Tray 第一項顯示版號、`onCheckUpdate` 選項與選單項 |
| `renderer/src/components/SourceNav.jsx` | logo area 顯示版號 |
| `renderer/src/pages/SettingsPage.jsx` | 右上角顯示版號（已有） |
| `electron-builder.yml` | 完整 build 設定（files、extraResources、nsis、publish） |
| `scripts/download-yt-dlp.js` | 下載 yt-dlp binary 到 `build/bin/` |

### 待實作（未來版本）

| 項目 | 說明 |
|------|------|
| Code signing | macOS / Windows 簽名，消除 Gatekeeper / SmartScreen 警告 |
| Linux build | AppImage 或 deb 打包 |
| 發佈自動化 | GitHub Actions CI/CD：push tag → build → upload to Releases |

---

## 9. 驗證步驟

### Bug Fix 驗證

1. `npm start` 後開啟 `http://localhost:3579/#/feed`
   - **預期**：SourceNav 左欄 logo 下方顯示版號（例如 `v0.2.0`）
2. 開啟 `http://localhost:3579/#/settings`
   - **預期**：Settings 頁面右上角顯示版號

### Electron 模式驗證

3. `npm run electron:start` 後，Tray 右鍵選單
   - **預期**：第一項顯示「XQDigest v0.2.0」
4. Packaged app（DMG / exe 安裝後）：Tray 右鍵選單
   - **預期**：有「檢查更新」選項，點擊後出現 dialog（已是最新版 或 提示下載）

### Packaged App 路徑驗證

5. 安裝後啟動（macOS）：
   - **預期**：資料存放於 `~/Library/Application Support/XQDigest/`
   - **預期**：yt-dlp 使用 `{app}/Contents/Resources/bin/yt-dlp`

### 首次執行驗證

6. 移除 `{userData}/.firstrun` 後重新啟動
   - **預期**：自動開啟瀏覽器至 Settings 頁面
