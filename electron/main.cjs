const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const http = require('http')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const unzipper = require('unzipper')

// 应用内点击即播放：音视频自动播放不要求额外用户手势（本地媒体播放器语义）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

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
  '.txt': 'text/plain',
  // —— 媒体（音频/视频/字幕/歌词）——
  '.flac': 'audio/flac', '.aac': 'audio/aac', '.oga': 'audio/ogg', '.opus': 'audio/opus',
  '.wav': 'audio/wav', '.wv': 'audio/x-wavpack', '.ape': 'audio/x-monkeys-audio',
  '.wma': 'audio/x-ms-wma', '.aiff': 'audio/aiff', '.aif': 'audio/aiff',
  '.dsf': 'audio/dsf', '.dff': 'audio/dsd', '.m4b': 'audio/mp4', '.mid': 'audio/midi',
  '.m4v': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv', '.ts': 'video/mp2t', '.m2ts': 'video/mp2t',
  '.rmvb': 'video/x-pn-realvideo', '.3gp': 'video/3gpp', '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg', '.vob': 'video/dvd',
  '.srt': 'application/x-subrip', '.vtt': 'text/vtt', '.ass': 'text/x-ssa',
  '.ssa': 'text/x-ssa', '.lrc': 'text/plain'
}

const MEDIA_AUDIO_EXT = ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'wv', 'ape', 'wma', 'aiff', 'aif', 'dsf', 'dff', 'm4b', 'mid']
const MEDIA_VIDEO_EXT = ['mp4', 'm4v', 'mkv', 'webm', 'mov', 'avi', 'flv', 'wmv', 'ts', 'm2ts', 'rmvb', '3gp', 'mpg', 'mpeg', 'vob']

// —— 媒体文件服务 ——
// 把任意本地音视频文件通过 http://127.0.0.1:<port>/m/<base64url(path)> 暴露给渲染进程。
// <audio>/<video> 走 http（而非 file://）才能可靠支持 Range 请求（拖动进度/缓冲必需）。
// 安全模型：只有「导入过」的路径（open-media-files 返回 + media-register 登记）才允许访问，
// 未登记路径一律 403，避免本机任意文件被渲染进程读取。
const allowedMediaPaths = new Set()

let mediaServer = null
let mediaBaseUrl = ''
function startMediaServer() {
  if (mediaServer) return
  mediaServer = http.createServer((req, res) => {
    try {
      const u = new URL(req.url, 'http://localhost')
      const parts = u.pathname.split('/').filter(Boolean) // ['m', base64...]
      if (parts.length !== 2 || parts[0] !== 'm') { res.writeHead(400); return res.end('bad path') }
      let filePath
      try {
        filePath = Buffer.from(parts[1], 'base64url').toString('utf8')
      } catch {
        res.writeHead(400); return res.end('bad id')
      }
      const resolved = path.resolve(filePath)
      if (!allowedMediaPaths.has(resolved) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        res.writeHead(403); return res.end('forbidden')
      }
      const stat = fs.statSync(resolved)
      const size = stat.size
      const ext = path.extname(resolved).toLowerCase()
      const mime = MIME[ext] || 'application/octet-stream'
      const range = req.headers.range
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range)
        if (!m) { res.writeHead(416); return res.end() }
        let start = m[1] ? parseInt(m[1], 10) : 0
        let end = m[2] ? parseInt(m[2], 10) : size - 1
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
          res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end()
        }
        if (end >= size) end = size - 1
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Content-Type': mime,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600'
        })
        if (req.method === 'HEAD') return res.end()
        fs.createReadStream(resolved, { start, end }).pipe(res)
      } else {
        res.writeHead(200, {
          'Content-Length': size,
          'Accept-Ranges': 'bytes',
          'Content-Type': mime,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600'
        })
        if (req.method === 'HEAD') return res.end()
        fs.createReadStream(resolved).pipe(res)
      }
    } catch (e) {
      res.writeHead(500); res.end(String(e))
    }
  })
  mediaServer.listen(0, '127.0.0.1', () => {
    const port = mediaServer.address().port
    mediaBaseUrl = `http://127.0.0.1:${port}/m/`
    console.log('[nr] media http server on', mediaBaseUrl)
    // 推送给渲染进程（preload 缓存，渲染侧可同步读取）
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.webContents.send('media-base-url', mediaBaseUrl)
  })
}

// 主进程侧音频元数据解析（music-metadata 为 ESM-only，CJS 主进程走动态 import 并缓存）
let mmModule = null
async function getMusicMetadata() {
  if (!mmModule) mmModule = await import('music-metadata')
  return mmModule
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
  startMediaServer()
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

// —— 文献查阅：联网代理 ——
// 渲染进程受 CSP/CORS 限制，统一由主进程发起 http 请求并回传文本。
// 只允许 http(s)、设 8s 超时（被墙的源不再让用户干等十几秒）、截断超长响应。
ipcMain.handle('lookup-fetch', async (e, url) => {
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { error: 'invalid url' }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        // Wikipedia 等开放 API 要求带可识别 UA，否则会被限流
        'User-Agent': 'MAGI/2.0 (https://github.com/noemoe5/MAGI)',
        Accept: 'application/json,text/html;q=0.9,*/*;q=0.8'
      }
    })
    const text = await res.text()
    return { ok: res.ok, status: res.status, text: text.slice(0, 300000) }
  } catch (err) {
    return { error: String(err) }
  } finally {
    clearTimeout(timer)
  }
})

// 用系统默认浏览器打开链接（查阅结果里的参考链接）
ipcMain.handle('open-external', async (e, url) => {
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false
  try { await shell.openExternal(url); return true } catch { return false }
})

// 选一个 JSON 文件并读取（导入本地知识库 / 文献库）
ipcMain.handle('open-json', async () => {
  const res = await dialog.showOpenDialog(null, {
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (res.canceled || !res.filePaths[0]) return null
  try {
    return { path: res.filePaths[0], text: fs.readFileSync(res.filePaths[0], 'utf-8') }
  } catch (err) {
    return { error: String(err) }
  }
})

// 另存为 JSON（导出本地知识库 / 文献库）
ipcMain.handle('save-json', async (e, defaultName, content) => {
  const res = await dialog.showSaveDialog(null, {
    defaultPath: defaultName || 'export.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (res.canceled || !res.filePath) return false
  try {
    fs.writeFileSync(res.filePath, content)
    return true
  } catch (err) {
    return { error: String(err) }
  }
})

// —— 媒体（音频/视频）IPC ——

// 选文件：音频/视频/音视频混合
ipcMain.handle('open-media-files', async (e, kind) => {
  const filters =
    kind === 'audio'
      ? [{ name: 'Audio', extensions: MEDIA_AUDIO_EXT }]
      : kind === 'video'
        ? [{ name: 'Video', extensions: MEDIA_VIDEO_EXT }]
        : [{ name: 'Media', extensions: [...MEDIA_AUDIO_EXT, ...MEDIA_VIDEO_EXT] }]
  const res = await dialog.showOpenDialog(null, {
    properties: ['openFile', 'multiSelections'],
    filters
  })
  const paths = res.canceled ? [] : res.filePaths
  paths.forEach((p) => allowedMediaPaths.add(path.resolve(p)))
  return paths
})

// 选目录：递归收集音视频文件（Folia 本地库式的文件夹导入），上限 2000 个
ipcMain.handle('open-media-dir', async (e, kind) => {
  const exts = kind === 'audio' ? MEDIA_AUDIO_EXT : kind === 'video' ? MEDIA_VIDEO_EXT : [...MEDIA_AUDIO_EXT, ...MEDIA_VIDEO_EXT]
  const res = await dialog.showOpenDialog(null, { properties: ['openDirectory'] })
  if (res.canceled || !res.filePaths[0]) return []
  const root = res.filePaths[0]
  const out = []
  const walk = (dir, depth) => {
    if (depth > 8 || out.length >= 2000) return
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const ent of entries) {
      if (out.length >= 2000) return
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(full, depth + 1)
      else if (exts.includes(path.extname(ent.name).toLowerCase().slice(1))) out.push(full)
    }
  }
  walk(root, 0)
  out.forEach((p) => allowedMediaPaths.add(path.resolve(p)))
  return out
})

// 登记媒体路径（书库恢复/播放队列回放时渲染进程重新注册）
ipcMain.handle('media-register', (e, paths) => {
  if (Array.isArray(paths)) paths.forEach((p) => typeof p === 'string' && allowedMediaPaths.add(path.resolve(p)))
  return true
})

// 媒体 http 基址（渲染进程拼 /m/<base64url(path)>）
ipcMain.handle('media-base-url', () => mediaBaseUrl)

// 音频元数据探测：ID3v2/ID3v1/FLAC/Vorbis/MP4/APE，标题/艺人/专辑/年份/流派/时长/内嵌封面/内嵌歌词
ipcMain.handle('media-probe', async (e, p) => {
  if (!p || typeof p !== 'string') return { error: 'invalid path' }
  try {
    const { parseFile } = await getMusicMetadata()
    const md = await parseFile(p, { duration: true, skipCovers: false, offline: true })
    const fmt = md.format || {}
    const common = md.common || {}
    let cover = null
    let coverFormat = null
    const pic = common.picture && common.picture[0]
    if (pic && pic.data && pic.data.length <= 8 * 1024 * 1024) {
      cover = pic.data.toString('base64')
      coverFormat = pic.format || 'image/jpeg'
    }
    let lyricsPlain = ''
    let lyricsSynced = null
    if (typeof common.lyrics === 'string') lyricsPlain = common.lyrics
    else if (Array.isArray(common.lyrics)) {
      const timed = common.lyrics.filter((l) => typeof l.timestamp === 'number')
      if (timed.length) {
        lyricsSynced = timed.map((l) => ({ t: l.timestamp, text: l.text || '' }))
      } else {
        lyricsPlain = common.lyrics.map((l) => l.text || '').join('\n')
      }
    }
    return {
      kind: 'audio',
      title: common.title || '',
      artist: common.artist || common.albumartist || '',
      album: common.album || '',
      albumartist: common.albumartist || '',
      year: common.year || '',
      genre: (common.genre || [])[0] || '',
      track: common.track?.no ?? null,
      duration: fmt.duration || 0,
      lossless: !!fmt.lossless,
      sampleRate: fmt.sampleRate || 0,
      bitsPerSample: fmt.bitsPerSample || 0,
      channels: fmt.numberOfChannels || 0,
      container: fmt.container || '',
      codec: fmt.codec || '',
      cover,
      coverFormat,
      lyricsPlain,
      lyricsSynced
    }
  } catch (err) {
    return { error: String(err) }
  }
})

// 读媒体同目录的sidecar文件：同名 .lrc 歌词 / 多语言 .srt/.vtt/.ass 字幕
const SUB_EXT_LABEL = { '.zh-cn.srt': '简体', '.zh.srt': '简体', '.chs.srt': '简体', '.zh-cn.ass': '简体', '.zh.ass': '简体', '.eng.srt': 'English', '.en.srt': 'English', '.english.srt': 'English', '.default.srt': '默认', '.srt': '默认' }
ipcMain.handle('media-sidecar', async (e, p) => {
  if (!p || typeof p !== 'string') return { lrc: null, subtitles: [] }
  const dir = path.dirname(p)
  const base = path.basename(p).replace(/\.[^.]+$/, '')
  let lrc = null
  const subtitles = []
  const tryRead = (fp) => { try { return fs.readFileSync(fp, 'utf8') } catch { return null } }
  const lrcPath = path.join(dir, base + '.lrc')
  if (fs.existsSync(lrcPath)) lrc = tryRead(lrcPath)
  for (const ext of ['.srt', '.vtt', '.ass', '.ssa']) {
    // 直接同名（video.srt）与带语言标记（video.zh-cn.srt / video.eng.srt）
    const direct = path.join(dir, base + ext)
    if (fs.existsSync(direct)) subtitles.push({ name: base + ext, path: direct, lang: '默认' })
    let langEntries = []
    try {
      langEntries = fs.readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile() && d.name.startsWith(base + '.') && d.name.endsWith(ext))
        .map((d) => d.name)
    } catch { /* ignore */ }
    for (const name of langEntries) {
      const marker = name.slice(base.length + 1, -ext.length)
      subtitles.push({ name, path: path.join(dir, name), lang: SUB_EXT_LABEL['.' + marker + ext] || marker })
    }
  }
  // 字幕文本按需读取，返回清单即可
  return { lrc, subtitles }
})

ipcMain.handle('media-read-text', (e, p) => {
  if (!p || typeof p !== 'string') return { error: 'invalid path' }
  try { return { text: fs.readFileSync(p, 'utf8') } } catch (err) { return { error: String(err) } }
})

ipcMain.on('win-min', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.minimize() })
ipcMain.on('win-max', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) (w.isMaximized() ? w.unmaximize() : w.maximize()) })
ipcMain.on('win-close', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.close() })
