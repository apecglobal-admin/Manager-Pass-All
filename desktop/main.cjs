const electron = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

let appServer;
const desktopPort = process.env.PORT || '39110';
let logFile = path.join(process.env.APPDATA || process.cwd(), 'ApecGlobal Manager', 'desktop-main.log');

function log(message, error) {
  const line = `[${new Date().toISOString()}] ${message}${error ? `\n${error.stack || error.message || error}` : ''}\n`;
  console.log(line.trimEnd());
  if (!logFile) return;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line);
  } catch {
    // Logging must never block app startup.
  }
}

log('Desktop main loaded');

if (typeof electron === 'string') {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  log('Relaunching Electron without ELECTRON_RUN_AS_NODE');
  const child = spawn(process.execPath, process.argv.slice(1), {
    detached: true,
    env,
    stdio: 'ignore'
  });
  child.unref();
  process.exit(0);
}

const { app, BrowserWindow, dialog, shell } = electron;

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    icon: iconPath,
    backgroundColor: '#faf8ff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadURL(process.env.APECGLOBAL_APP_URL || `http://localhost:${desktopPort}`);
}

async function startLocalServer() {
  if (process.env.APECGLOBAL_APP_URL) return;
  const serverPath = path.join(__dirname, '..', 'src', 'server.js');
  process.env.PORT = desktopPort;
  process.env.DATA_DIR = process.env.DATA_DIR || path.join(process.env.APPDATA || app.getPath('appData'), 'apecglobal-manager');
  fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  logFile = path.join(process.env.DATA_DIR, 'desktop-main.log');
  log(`Starting desktop server from ${serverPath}`);
  const { createApp } = await import(pathToFileURL(serverPath).href);
  appServer = createApp();
  await appServer.listen(Number(desktopPort));
  log(`Desktop server listening on http://localhost:${desktopPort}`);
}

function configureAutoUpdater() {
  if (!app.isPackaged || process.env.APECGLOBAL_DISABLE_AUTO_UPDATE === '1') {
    log('Auto update skipped');
    return;
  }

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (error) {
    log('Desktop auto updater could not load', error);
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  let updateDownloadStarted = false;

  autoUpdater.on('checking-for-update', () => log('Checking for desktop updates'));
  autoUpdater.on('update-available', info => {
    if (updateDownloadStarted) return;
    log(`Desktop update available: ${info.version}`);
    showUpdateAvailableDialog(autoUpdater, info, () => {
      updateDownloadStarted = true;
    }).catch(error => log('Failed to show update available dialog', error));
  });
  autoUpdater.on('update-not-available', info => log(`Desktop app is current: ${info.version}`));
  autoUpdater.on('download-progress', progress => {
    log(`Desktop update download ${Math.round(progress.percent || 0)}%`);
  });
  autoUpdater.on('error', error => log('Desktop auto update failed', error));
  autoUpdater.on('update-downloaded', info => {
    log(`Desktop update downloaded: ${info.version}`);
    dialog.showMessageBox({
      type: 'info',
      title: 'Có bản cập nhật mới',
      message: `ApecGlobal Manager ${info.version} đã sẵn sàng cài đặt.`,
      detail: 'Khởi động lại ứng dụng để cài bản cập nhật mới.',
      buttons: ['Khởi động lại', 'Để sau'],
      defaultId: 0,
      cancelId: 1
    }).then(result => {
      if (result.response === 0) autoUpdater.quitAndInstall(false, true);
    }).catch(error => log('Failed to show update dialog', error));
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(error => log('Desktop update check failed', error));
  }, 5000);
}

async function showUpdateAvailableDialog(autoUpdater, info, onDownloadStarted = () => {}) {
  const version = info?.version || 'mới';
  const releaseUrl = getLatestReleaseUrl();
  const result = await dialog.showMessageBox({
    type: 'info',
    title: 'Có bản cập nhật mới',
    message: `ApecGlobal Manager ${version} đã có sẵn.`,
    detail: `Phiên bản hiện tại: ${app.getVersion()}\nBạn có muốn tải và cài đặt bản mới không?`,
    buttons: ['Tải & cài đặt', 'Để sau', 'Mở trang tải'],
    defaultId: 0,
    cancelId: 1
  });

  if (result.response === 0) {
    onDownloadStarted();
    await autoUpdater.downloadUpdate();
    return;
  }
  if (result.response === 2) {
    await shell.openExternal(releaseUrl);
  }
}

function getLatestReleaseUrl() {
  return 'https://github.com/apecglobal-admin/Manager-Pass-All/releases/latest';
}

app.whenReady().then(() => {
  startLocalServer()
    .then(() => {
      createWindow();
      configureAutoUpdater();
    })
    .catch(error => {
      log('Failed to start desktop server', error);
      app.quit();
    });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (appServer) appServer.close().catch(() => null);
});

process.on('uncaughtException', error => {
  log('Uncaught exception in desktop main', error);
});

process.on('unhandledRejection', error => {
  log('Unhandled rejection in desktop main', error);
});
