// Windows x64 desktop shell for SKYSONG: a fast, GPU-forced, fullscreen-capable window.
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

// Force the fast GPU path and keep rendering smooth (no vsync-throttling when unfocused, no FPS cap).
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('use-angle', 'd3d11');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function create() {
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1280, height: 720, backgroundColor: '#0b0f1e', autoHideMenuBar: true, show: false,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type === 'keyDown' && i.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
}

app.whenReady().then(create);
app.on('window-all-closed', () => app.quit());
