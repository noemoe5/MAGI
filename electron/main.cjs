const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const unzipper = require('unzipper')

// 自定义协议：把「解压后的 EPUB 目录」暴露给渲染进程。
// EPUB.js 走 directory 模式时只会按需 fetch 单个文件（container.xml / opf / 章节 / 图片），
// 不再用 JSZip 把整本 zip 解压进内存 —— 这是支持几百 MB 大文件的关键。
protocol.registerSchemesAsPrivileged([
  { scheme: 'nrbook', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
])

let mainWindow

// 解压缓存目录（临时目录，按 路径+大小+修改时间 计算 id，文件变了自动失效重解压）
function epubDir() {
  return path.join(app.getPath('temp'), 'nr-epub')
}

function hashId(p, size, mtime) {
  return crypto.createHash('sha1').update(`${p}|${size}|${mtime}`).digest('hex').slice(0, 20)
}

// 流式解压（unzipper 边读边写磁盘，内存 O(1)），解压完写 .extracted 标记避免重复解压
function ensureExtracted(p) {
  const stat = fs.statSync(p)
  const id = hashId(p, stat.size, stat.mtimeMs)
  const dir = path.join(epubDir(), id)
  const marker = path.join(dir, '.extracted')
  if (fs.existsSync(marker)) return Promise.resolve(id)
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  fs.mkdirSync(dir, { recursive: true })
  return new Promise((resolve, reject) => {
    fs.createReadStream(p)
      .pipe(unzipper.Extract({ path: dir }))
      .on('close', () => {
        try { fs.writeFileSync(marker, '1') } catch { /* ignore */ }
        resolve(id)
      })
      .on('error', (e) => {
        try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
        reject(e)
      })
  })
}

function registerBookProtocol() {
  protocol.registerFileProtocol('nrbook', (request, callback) => {
    try {
      const u = new URL(request.url)
      const id = u.hostname
      let rel = decodeURIComponent(u.pathname) // 形如 /META-INF/container.xml
      // 规范化并阻止 ../ 路径穿越
      const normalized = path.normalize(rel).replace(/^(\.\.[/\\])+/, '')
      const filePath = path.join(epubDir(), id, normalized)
      const rp = path.resolve(filePath)
      const base = path.resolve(epubDir())
      if (rp !== base && !rp.startsWith(base + path.sep)) {
        callback({ error: -6 }) // 越界，拒绝
        return
      }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        callback({ error: -6 })
        return
      }
      callback({ path: filePath })
    } catch (e) {
      callback({ error: -2 })
    }
  })
}

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

app.whenReady().then(() => {
  registerBookProtocol()
  createWindow()
})

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

// 打开书：epub 流式解压到临时目录并返回 nrbook:// 协议基址（渲染进程按目录加载，不再整包解压）；
// txt 直接读全文返回文本。大文件（数百 MB）也能加载，因为解压是流式写盘、阅读时按需取单文件。
ipcMain.handle('open-book', async (e, p) => {
  if (!p || typeof p !== 'string') return { error: 'invalid path' }
  if (/\.txt$/i.test(p)) {
    try {
      const text = fs.readFileSync(p, 'utf-8')
      return { kind: 'txt', text }
    } catch (err) {
      return { error: String(err) }
    }
  }
  try {
    const id = await ensureExtracted(p)
    return { kind: 'epub', baseUrl: `nrbook://${id}` }
  } catch (err) {
    return { error: String(err) }
  }
})

// 读文件为 base64（保留旧接口，备用）
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
