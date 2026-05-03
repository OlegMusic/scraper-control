// Electron wrapper для Scraper Control. Открывает либо http://localhost:5173 (dev),
// либо собранный prod-билд (если зайдёт в build режим — пока вне scope MVP).
//
// Запуск: cd desktop && npm install && npm run dev
// Перед этим должны быть запущены server (порт 3100) и web (порт 5173).

const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

const DEV_URL = process.env.SC_URL || 'http://localhost:5173';

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#0f172a',
    title: 'Scraper Control',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadURL(DEV_URL).catch(err => {
    console.error('Не удалось загрузить:', DEV_URL, err.message);
    win.loadFile(path.join(__dirname, 'fallback.html')).catch(() => {});
  });

  // Внешние ссылки открываем в системном браузере
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(DEV_URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Меню — на русском
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Файл',
      submenu: [
        { label: 'Перезагрузить', accelerator: 'F5', click: () => win.reload() },
        { label: 'Открыть DevTools', accelerator: 'F12', click: () => win.webContents.openDevTools() },
        { type: 'separator' },
        { label: 'Выход', accelerator: 'Ctrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Увеличить', accelerator: 'Ctrl+=', click: () => win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5) },
        { label: 'Уменьшить', accelerator: 'Ctrl+-', click: () => win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5) },
        { label: 'Сбросить масштаб', accelerator: 'Ctrl+0', click: () => win.webContents.setZoomLevel(0) },
        { type: 'separator' },
        { label: 'Полный экран', accelerator: 'F11', click: () => win.setFullScreen(!win.isFullScreen()) },
      ],
    },
  ]));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
