const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

let mainWindow

function libPath() {
  return path.join(app.getPath('userData'), 'library.json')
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 820,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#1e1e1e',
    // 先隐藏，等首帧渲染好再显示 —— 消除启动白屏闪烁
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      // 窗口失焦/遮挡时不降频，保证动画始终跑满 60fps
      backgroundThrottling: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  const isDev = process.env.NODE_ENV === 'development'
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 打开系统文件选择框，返回选中路径
ipcMain.handle('open-files', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Books', extensions: ['epub', 'txt'] }]
  })
  return res.canceled ? [] : res.filePaths
})

// 读文件为 base64（epub 二进制 / txt 文本均可安全传输）
ipcMain.handle('read-file', (e, p) => {
  try {
    return fs.readFileSync(p).toString('base64')
  } catch (err) {
    return { error: String(err) }
  }
})

ipcMain.handle('read-library', () => {
  try {
    return JSON.parse(fs.readFileSync(libPath(), 'utf-8'))
  } catch {
    return null
  }
})

ipcMain.handle('write-library', (e, data) => {
  try {
    // 原子写：先写临时文件再改名，避免写一半崩溃导致书库 JSON 损坏
    const target = libPath()
    const tmp = target + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(data))
    fs.renameSync(tmp, target)
    return true
  } catch (err) {
    return { error: String(err) }
  }
})

ipcMain.handle('get-path', () => app.getPath('userData'))

ipcMain.on('win-min', () => mainWindow && mainWindow.minimize())
ipcMain.on('win-max', () =>
  mainWindow && (mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize())
)
ipcMain.on('win-close', () => mainWindow && mainWindow.close())
