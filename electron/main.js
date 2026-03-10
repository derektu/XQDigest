const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const AppEngine = require('../src/app-engine');
const TrayManager = require('./tray');

// Tray-only app — no GPU needed
app.disableHardwareAcceleration();

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.error('Another instance is already running.');
  app.quit();
}

let engine = null;
let trayManager = null;

app.on('ready', async () => {
  let userConfigPath;
  let firstRunFile;
  let isFirstRun = false;

  if (app.isPackaged) {
    // A. Packaged app: 資料目錄改到系統 userData
    process.env.XQDIGEST_DATA_PATH = app.getPath('userData');
    userConfigPath = path.join(app.getPath('userData'), 'settings.json');

    // B. First-run detection (only in packaged app)
    firstRunFile = path.join(app.getPath('userData'), '.firstrun');
    isFirstRun = !fs.existsSync(firstRunFile);
  }
  // Dev mode: XQDIGEST_DATA_PATH 不設定 → data/logs 沿用 working folder

  // Hide dock icon on macOS (tray-only)
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  // Auto-update state (in-memory only, resets on app restart)
  // Status: idle | checking | downloading | downloaded
  const updaterState = {
    status: 'idle',
    pendingVersion: null,
  };

  // Handler wired to tray "檢查更新" — responds based on current state
  const handleCheckUpdate = app.isPackaged
    ? () => {
        const { autoUpdater } = require('electron-updater');
        const { dialog } = require('electron');

        if (updaterState.status === 'checking') {
          dialog.showMessageBox({
            type: 'info',
            title: 'XQDigest',
            message: '正在檢查更新中，請稍候...',
            buttons: ['確定'],
            noLink: true,
          });
          return;
        }

        if (updaterState.status === 'downloading') {
          dialog.showMessageBox({
            type: 'info',
            title: 'XQDigest',
            message: `v${updaterState.pendingVersion} 正在背景下載中`,
            detail: '下載完成後將自動通知您安裝。',
            buttons: ['確定'],
            noLink: true,
          });
          return;
        }

        if (updaterState.status === 'downloaded') {
          dialog.showMessageBox({
            type: 'info',
            title: 'XQDigest 更新已就緒',
            message: `v${updaterState.pendingVersion} 已下載完成`,
            detail: '是否立即重啟並安裝更新？',
            buttons: ['立即重啟', '稍後'],
            defaultId: 0,
            noLink: true,
          }).then(({ response }) => {
            if (response === 0) autoUpdater.quitAndInstall();
          });
          return;
        }

        // idle or up-to-date: start a fresh check
        updaterState.status = 'checking';
        autoUpdater.checkForUpdates();
      }
    : null;

  engine = new AppEngine({ configPath: userConfigPath });
  trayManager = new TrayManager(engine, {
    onCheckUpdate: handleCheckUpdate,
  });

  engine.on('stateChange', (state) => {
    trayManager.updateState(state);
  });

  engine.on('serverReady', (port) => {
    trayManager.setPort(port);
    if (isFirstRun && firstRunFile) {
      fs.writeFileSync(firstRunFile, '');
      shell.openExternal(`http://localhost:${port}/#/settings`);
    }
  });

  engine.on('error', (err) => {
    console.error('AppEngine error:', err.message);
  });

  try {
    await engine.start();
  } catch (err) {
    console.error('Failed to start engine:', err.message);
    const { dialog } = require('electron');
    dialog.showErrorBox(
      'XQDigest 啟動失敗',
      `無法啟動應用程式：\n\n${err.message}\n\n請回報此錯誤。`
    );
  }

  // C. Auto-update (only in packaged app, not dev mode)
  if (app.isPackaged) {
    const { autoUpdater } = require('electron-updater');
    const { dialog } = require('electron');
    const logger = require('../src/logger');

    autoUpdater.autoDownload = false;

    autoUpdater.on('checking-for-update', () => {
      updaterState.status = 'checking';
    });

    autoUpdater.on('update-available', async (info) => {
      updaterState.pendingVersion = info.version;
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: 'XQDigest 有新版本',
        message: `版本 ${info.version} 已發布`,
        detail: '是否要立即下載更新？下載將在背景進行，完成後會通知您。',
        buttons: ['開始下載', '稍後再說'],
        defaultId: 0,
        noLink: true,
      });
      if (response === 0) {
        updaterState.status = 'downloading';
        autoUpdater.downloadUpdate();
        dialog.showMessageBox({
          type: 'info',
          title: 'XQDigest',
          message: `v${info.version} 正在背景下載中`,
          detail: '下載完成後將自動通知您安裝。',
          buttons: ['確定'],
          noLink: true,
        });
      } else {
        updaterState.status = 'idle';
      }
    });

    autoUpdater.on('update-downloaded', async () => {
      updaterState.status = 'downloaded';
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: '更新已下載完成',
        message: `v${updaterState.pendingVersion} 下載完成`,
        detail: '重新啟動後將安裝更新。',
        buttons: ['立即重啟', '稍後'],
        defaultId: 0,
        noLink: true,
      });
      if (response === 0) autoUpdater.quitAndInstall();
    });

    autoUpdater.on('error', (err) => {
      updaterState.status = 'idle';
      updaterState.pendingVersion = null;
      logger.getLogger('AutoUpdater').warn(`Auto-update error: ${err.message}`);
      // "No published versions" means no releases on GitHub yet → treat as already up-to-date
      if (err.message.includes('No published versions')) {
        dialog.showMessageBox({
          type: 'info',
          title: 'XQDigest',
          message: '已是最新版本',
          buttons: ['確定'],
          noLink: true,
        });
      }
    });

    // Delay check to avoid blocking startup
    setTimeout(() => {
      updaterState.status = 'checking';
      autoUpdater.checkForUpdates();
    }, 10000);
  }
});

// Open browser when second instance is launched
app.on('second-instance', () => {
  const port = engine && engine.getApiPort();
  if (port) {
    shell.openExternal(`http://localhost:${port}`);
  }
});

// Tray-only: don't quit when all windows are closed
app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.on('before-quit', async (e) => {
  if (engine && ['running', 'paused'].includes(engine.getState())) {
    e.preventDefault();
    try {
      await engine.stop();
    } catch (err) {
      console.error('Error during shutdown:', err.message);
    }
    app.quit();
  }
});
