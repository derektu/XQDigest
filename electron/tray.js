const path = require('path');
const { app, Tray, Menu, nativeImage, shell } = require('electron');

class TrayManager {
  constructor(engine) {
    this._engine = engine;
    this._tray = null;
    this._state = engine.getState();
    this._port = null;
    this._createTray();
  }

  _getIconPath() {
    if (process.platform === 'darwin') {
      return path.join(__dirname, 'icons', 'iconTemplate.png');
    }
    return path.join(__dirname, 'icons', 'icon-win.png');
  }

  _createTray() {
    const icon = nativeImage.createFromPath(this._getIconPath());

    let trayIcon;
    if (process.platform === 'darwin') {
      trayIcon = icon.resize({ width: 16, height: 16 });
      trayIcon.setTemplateImage(true);
    } else {
      trayIcon = icon;
    }

    this._tray = new Tray(trayIcon);
    this._tray.setToolTip('XQDigest');
    this._buildMenu();
  }

  _buildMenu() {
    const isRunning = this._state === 'running';
    const isPaused = this._state === 'paused';
    const hasPort = this._port !== null;

    const menu = Menu.buildFromTemplate([
      { label: 'XQDigest', enabled: false },
      { type: 'separator' },
      {
        label: 'Settings',
        enabled: hasPort,
        click: () => {
          shell.openExternal(`http://localhost:${this._port}`);
        },
      },
      { type: 'separator' },
      {
        label: 'Pause',
        enabled: isRunning,
        click: () => {
          try { this._engine.pause(); } catch (err) { console.error('Pause failed:', err.message); }
        },
      },
      {
        label: 'Resume',
        enabled: isPaused,
        click: () => {
          try { this._engine.resume(); } catch (err) { console.error('Resume failed:', err.message); }
        },
      },
      { type: 'separator' },
      { label: `Status: ${this._state}`, enabled: false },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => app.quit(),
      },
    ]);

    this._tray.setContextMenu(menu);
  }

  setPort(port) {
    this._port = port;
    this._buildMenu();
  }

  updateState(state) {
    this._state = state;
    // Only clear port when fully stopped
    if (state === 'stopped') {
      this._port = null;
    }
    this._buildMenu();
  }

  destroy() {
    if (this._tray) {
      this._tray.destroy();
      this._tray = null;
    }
  }
}

module.exports = TrayManager;
