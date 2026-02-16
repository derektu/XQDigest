const path = require('path');
const { app, Tray, Menu, nativeImage } = require('electron');

class TrayManager {
  constructor(engine) {
    this._engine = engine;
    this._tray = null;
    this._state = engine.getState();
    this._createTray();
  }

  _getIconPath() {
    // macOS: "Template" suffix triggers auto dark/light mode adaptation
    // Windows/Linux: use the @2x (32x32) version directly
    if (process.platform === 'darwin') {
      return path.join(__dirname, 'icons', 'iconTemplate.png');
    }
    return path.join(__dirname, 'icons', 'iconTemplate@2x.png');
  }

  _createTray() {
    const icon = nativeImage.createFromPath(this._getIconPath());

    let trayIcon;
    if (process.platform === 'darwin') {
      // macOS expects ~16x16 at 1x, template image adapts to menu bar theme
      trayIcon = icon.resize({ width: 16, height: 16 });
      trayIcon.setTemplateImage(true);
    } else {
      // Windows/Linux: use icon as-is (32x32)
      trayIcon = icon;
    }

    this._tray = new Tray(trayIcon);
    this._tray.setToolTip('XQDigest');
    this._buildMenu();
  }

  _buildMenu() {
    const isRunning = this._state === 'running';
    const isStopped = this._state === 'stopped';

    const menu = Menu.buildFromTemplate([
      { label: 'XQDigest', enabled: false },
      { type: 'separator' },
      {
        label: 'Start',
        enabled: isStopped,
        click: () => this._engine.start().catch(err => console.error('Start failed:', err.message)),
      },
      {
        label: 'Stop',
        enabled: isRunning,
        click: () => this._engine.stop().catch(err => console.error('Stop failed:', err.message)),
      },
      {
        label: 'Restart',
        enabled: isRunning,
        click: () => this._engine.restart().catch(err => console.error('Restart failed:', err.message)),
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

  updateState(state) {
    this._state = state;
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
