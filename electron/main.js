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
  // A. Set data path to userData before AppEngine init (packaged app)
  process.env.XQDIGEST_DATA_PATH = app.getPath('userData');

  // Hide dock icon on macOS (tray-only)
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  // B. First-run detection
  const firstRunFile = path.join(app.getPath('userData'), '.firstrun');
  const isFirstRun = !fs.existsSync(firstRunFile);

  const userConfigPath = path.join(app.getPath('userData'), 'settings.json');
  engine = new AppEngine({ configPath: userConfigPath });
  trayManager = new TrayManager(engine, {
    onCheckUpdate: app.isPackaged
      ? () => {
          const { autoUpdater } = require('electron-updater');
          autoUpdater.checkForUpdates();
        }
      : null,
  });

  engine.on('stateChange', (state) => {
    trayManager.updateState(state);
  });

  engine.on('serverReady', (port) => {
    trayManager.setPort(port);
    if (isFirstRun) {
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

    autoUpdater.on('update-available', async (info) => {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: 'XQDigest 有新版本',
        message: `版本 ${info.version} 已發布`,
        detail: '是否要立即下載更新？',
        buttons: ['下載更新', '稍後再說'],
        defaultId: 0,
      });
      if (response === 0) autoUpdater.downloadUpdate();
    });

    autoUpdater.on('update-downloaded', async () => {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: '更新已下載完成',
        message: '重新啟動後將安裝更新',
        buttons: ['立即重啟', '稍後'],
        defaultId: 0,
      });
      if (response === 0) autoUpdater.quitAndInstall();
    });

    autoUpdater.on('update-not-available', () => {
      dialog.showMessageBox({
        type: 'info',
        title: 'XQDigest',
        message: '已是最新版本',
        buttons: ['確定'],
      });
    });

    autoUpdater.on('error', (err) => {
      logger.getLogger('AutoUpdater').warn(`Auto-update error: ${err.message}`);
      // "No published versions" means no releases on GitHub yet → treat as already up-to-date
      if (err.message.includes('No published versions')) {
        dialog.showMessageBox({
          type: 'info',
          title: 'XQDigest',
          message: '已是最新版本',
          buttons: ['確定'],
        });
      }
    });

    // Delay check to avoid blocking startup
    setTimeout(() => autoUpdater.checkForUpdates(), 10000);
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
