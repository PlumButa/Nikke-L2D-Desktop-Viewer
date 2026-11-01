const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
const fs = require('fs');

app.commandLine.appendSwitch('enable-transparent-visuals');

let mainWindow;
let normalBounds = { width: 1920, height: 1080, x: 0, y: 0 };
let cursorTrackInterval = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    center: true,
    transparent: true,
    frame: false,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  normalBounds = mainWindow.getBounds();
  mainWindow.loadFile('index.html');
}

// 桌寵模式下：持續偵測全局滑鼠相對於螢幕中心的座標偏移 (供 aim_x / aim_y 轉動身體)
function startGlobalCursorTracking() {
  stopGlobalCursorTracking();
  cursorTrackInterval = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const pt = screen.getCursorScreenPoint();
    const display = screen.getPrimaryDisplay();
    const { x, y, width, height } = display.bounds;

    const normX = Math.min(1, Math.max(0, (pt.x - x) / width));
    const normY = Math.min(1, Math.max(0, 1.0 - ((pt.y - y) / height)));

    mainWindow.webContents.send('global-cursor-move', { normX, normY });
  }, 16);
}

function stopGlobalCursorTracking() {
  if (cursorTrackInterval) {
    clearInterval(cursorTrackInterval);
    cursorTrackInterval = null;
  }
}

// 切換「檢視器模式」與「全螢幕無邊際桌寵模式」
ipcMain.on('toggle-pet-mode', (event, isPetMode) => {
  if (!mainWindow) return;

  if (isPetMode) {
    normalBounds = mainWindow.getBounds();
    const primaryDisplay = screen.getPrimaryDisplay();
    const { x, y, width, height } = primaryDisplay.bounds;

    mainWindow.setResizable(false);
    mainWindow.setBounds({ x, y, width, height: height - 1 });
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    startGlobalCursorTracking();
  } else {
    stopGlobalCursorTracking();
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setIgnoreMouseEvents(false);
    mainWindow.setResizable(true);
    mainWindow.setBounds(normalBounds);
  }
});

// 動態設定滑鼠穿透
ipcMain.on('set-ignore-mouse', (event, ignore) => {
  if (!mainWindow) return;
  if (ignore) {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    mainWindow.setIgnoreMouseEvents(false);
  }
});

// 開啟「載入背景圖片」檔案選擇視窗
ipcMain.handle('select-bg-image', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '選擇背景圖片',
    properties: ['openFile'],
    filters: [
      { name: '圖片檔案', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }
    ]
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// 開啟「截取畫面」另存新檔視窗
ipcMain.handle('save-screenshot', async (event, dataUrl, defaultFileName) => {
  if (!mainWindow) return false;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '儲存截取畫面',
    defaultPath: defaultFileName || 'nikke_screenshot.png',
    filters: [
      { name: 'PNG 圖片', extensions: ['png'] }
    ]
  });
  if (result.canceled || !result.filePath) return false;

  const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(result.filePath, Buffer.from(base64Data, 'base64'));
  return true;
});

ipcMain.on('win-minimize', () => mainWindow?.minimize());
ipcMain.on('win-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('win-close', () => mainWindow?.close());

app.on('will-quit', stopGlobalCursorTracking);
app.whenReady().then(createWindow);