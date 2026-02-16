const { app } = require('electron');
const { execSync } = require('child_process');
const AppEngine = require('../src/app-engine');
const TrayManager = require('./tray');

// Windows: set console codepage to UTF-8
if (process.platform === 'win32') {
  try { execSync('chcp 65001', { stdio: 'ignore' }); } catch {}
}

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
  // Hide dock icon on macOS (tray-only)
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  engine = new AppEngine();
  trayManager = new TrayManager(engine);

  engine.on('stateChange', (state) => {
    trayManager.updateState(state);
  });

  engine.on('error', (err) => {
    console.error('AppEngine error:', err.message);
  });

  try {
    await engine.start();
  } catch (err) {
    console.error('Failed to start engine:', err.message);
  }
});

// Tray-only: don't quit when all windows are closed
app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.on('before-quit', async (e) => {
  if (engine && engine.getState() === 'running') {
    e.preventDefault();
    try {
      await engine.stop();
    } catch (err) {
      console.error('Error during shutdown:', err.message);
    }
    app.quit();
  }
});
