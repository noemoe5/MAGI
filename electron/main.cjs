const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const http = require('http')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const unzipper = require('unzipper')

// 大文件(EPUB)加载方案：
// 主进程把 epub 流式解压到临时目录(内存 O(1)，不会把整本塞进内存)，
// 再用本地 HTTP 服务把解压目录暴露给渲染进程。EPUB.js 走 directory 模式，
// 只按需 fetch 单个文件(container.xml / opf / 章节 / 图片)，彻底绕开 JSZip 整包解压。
// —— 这是支持几百 MB 甚至 GB 级 EPUB 的关键（自定义协议会被 epubjs 的 URL 解析破坏，故用 http）。

const MIME = {
  '.xhtml': 'application/xhtml+xml', '.html': 'text/html', '.htm': 'text/html',
  '.opf': 'application/oebps-package+xml', '.ncx': 'application/x-dtbncx+xml',
  '.xml': 'application/xml', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.avif': 'image/avif', '.tiff': 'image/tiff',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.ogg': 'audio/ogg',
  '.txt': 'text/plain'
}

function bookRoot() {
  return path.join(app.getPath('temp'), 'nr-epub')
}

function hashId(p, size, mtime) {
  return crypto.createHash('sha1').update(`${p}|${size}|${mtime}`).digest('hex').slice(0, 20)
}

// 流式解压（unzipper 边读边写磁盘，内存 O(1)），解压完写 .extracted 标记避免重复解压
function ensureExtracted(p) {
  const stat = fs.statSync(p)
  const id = hashId(p, stat.size, stat.mtimeMs)
  const dir = path.join(bookRoot(), id)
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

// 本地 HTTP 服务：把 /<id>/<relpath> 映射到解压目录。随机端口，渲染进程经 http 按需取文件。
let bookServer = null
let bookBaseUrl = ''
function startBookServer() {
  if (bookServer) return
  bookServer = http.createServer((req, res) => {
    try {
      const u = new URL(req.url, 'http://localhost')
      const parts = u.pathname.split('/').filter(Boolean) // [id, ...rel]
      if (parts.length === 0) { res.writeHead(400); return res.end('bad path') }
      const id = parts[0]
      const rel = '/' + decodeURIComponent(parts.slice(1).join('/'))
      const filePath = path.normalize(path.join(bookRoot(), id, rel))
      const rp = path.resolve(filePath)
      const base = path.resolve(bookRoot())
      // 阻止 ../ 路径穿越
      if (rp !== base && !rp.startsWith(base + path.sep)) { res.writeHead(403); return res.end('forbidden') }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) { res.writeHead(404); return res.end('not found') }
      const ext = path.extname(filePath).toLowerCase()
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600'
      })
      fs.createReadStream(filePath).pipe(res)
    } catch (e) {
      res.writeHead(500)
      res.end(String(e))
    }
  })
  bookServer.listen(0, '127.0.0.1', () => {
    const port = bookServer.address().port
    bookBaseUrl = `http://127.0.0.1:${port}/`
    console.log('[nr] book http server on', bookBaseUrl)
  })
}

function libPath() {
  return path.join(app.getPath('userData'), 'library.json')
}

function createWindow() {
  const mainWindow = new BrowserWindow({
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
  startBookServer()
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
  const res = await dialog.showOpenDialog(null, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Books', extensions: ['epub', 'txt'] }]
  })
  return res.canceled ? [] : res.filePaths
})

// 打开书：epub 流式解压到临时目录并返回 http 基址（渲染进程按目录加载，不再整包解压）；
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
    return { kind: 'epub', baseUrl: `${bookBaseUrl}${id}/` }
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

ipcMain.on('win-min', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.minimize() })
ipcMain.on('win-max', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) (w.isMaximized() ? w.unmaximize() : w.maximize()) })
ipcMain.on('win-close', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.close() })
