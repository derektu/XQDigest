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
  // Hide dock icon on macOS (tray-only)
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  engine = new AppEngine();
  trayManager = new TrayManager(engine);

  engine.on('stateChange', (state) => {
    trayManager.updateState(state);
  });

  engine.on('serverReady', (port) => {
    trayManager.setPort(port);
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
