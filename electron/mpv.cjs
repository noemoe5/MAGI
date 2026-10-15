// MAGI 视频引擎：mpv 控制器
//
// 做法：mpv 用 `--wid` 嵌入一个专用视频窗口（原生子窗口，画在 Electron 页面之上），
// 控制 UI 由另一个透明覆盖窗口承载，通过 JSON IPC（Windows 命名管道）双向通信。
// 只有这一条路能拿到真 HDR 直通（vo=gpu-next + target-colorspace-hint），
// Chromium 的 <video> 在 Windows 上做不到同样的色彩直通。
const { spawn } = require('child_process')
const net = require('net')
const path = require('path')
const fs = require('fs')

const PIPE_NAME = `magi-mpv-${process.pid}`
const PIPE_PATH = `\\\\.\\pipe\\${PIPE_NAME}`

/** mpv 可执行文件位置：开发期在 resources/mpv，打包后在 process.resourcesPath/mpv */
function resolveMpvPath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'mpv', 'mpv.exe'),
    path.join(__dirname, '..', 'resources', 'mpv', 'mpv.exe'),
    path.join(process.cwd(), 'resources', 'mpv', 'mpv.exe')
  ]
  for (const p of candidates) {
    try { if (p && fs.existsSync(p)) return p } catch { /* ignore */ }
  }
  return null
}

const isMpvAvailable = () => resolveMpvPath() !== null

/** Electron 的 getNativeWindowHandle() 是原生指针，按平台宽度还原成十进制 HWND */
function hwndOf(browserWindow) {
  const buf = browserWindow.getNativeWindowHandle()
  if (buf.length === 8) return buf.readBigUInt64LE(0).toString()
  return String(buf.readUInt32LE(0))
}

let mpv = null
let pipe = null
let pipeBuffer = ''
let requestId = 0
const pending = new Map()
const listeners = new Set()
let observedProps = new Set()
let currentState = {
  ok: false,
  playing: false,
  time: 0,
  duration: 0,
  buffered: 0,
  volume: 80,
  muted: false,
  speed: 1,
  width: 0,
  height: 0,
  eof: false
}

function emit(patch) {
  currentState = { ...currentState, ...patch }
  for (const fn of listeners) {
    try { fn(currentState) } catch { /* ignore */ }
  }
}

function onState(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function send(command) {
  if (!pipe || pipe.destroyed) return Promise.resolve(null)
  const id = ++requestId
  return new Promise((resolve) => {
    pending.set(id, resolve)
    try {
      pipe.write(JSON.stringify({ command, request_id: id }) + '\n')
    } catch {
      pending.delete(id)
      resolve(null)
    }
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); resolve(null) }
    }, 4000)
  })
}

const setProp = (name, value) => send(['set_property', name, value])

function handleMessage(line) {
  let msg
  try { msg = JSON.parse(line) } catch { return }
  if (msg.request_id && pending.has(msg.request_id)) {
    pending.get(msg.request_id)(msg)
    pending.delete(msg.request_id)
    return
  }
  if (msg.event === 'property-change') {
    const { name, data } = msg
    switch (name) {
      case 'time-pos': emit({ time: typeof data === 'number' ? data : 0 }); break
      case 'duration': emit({ duration: typeof data === 'number' ? data : 0 }); break
      case 'demuxer-cache-time': emit({ buffered: typeof data === 'number' ? data : 0 }); break
      case 'pause': emit({ playing: data === false }); break
      case 'volume': emit({ volume: typeof data === 'number' ? data : 0 }); break
      case 'mute': emit({ muted: data === true }); break
      case 'speed': emit({ speed: typeof data === 'number' ? data : 1 }); break
      case 'width': emit({ width: typeof data === 'number' ? data : 0 }); break
      case 'height': emit({ height: typeof data === 'number' ? data : 0 }); break
      case 'eof-reached': emit({ eof: data === true }); break
      default: break
    }
    return
  }
  if (msg.event === 'end-file') {
    emit({ eof: true, playing: false })
  }
}

function connectPipe(retries = 40) {
  return new Promise((resolve) => {
    const attempt = (left) => {
      const socket = net.connect(PIPE_PATH)
      socket.on('connect', () => {
        socket.setEncoding('utf8')
        pipe = socket
        socket.on('data', (chunk) => {
          pipeBuffer += chunk
          const lines = pipeBuffer.split('\n')
          pipeBuffer = lines.pop() || ''
          for (const line of lines) if (line.trim()) handleMessage(line)
        })
        socket.on('close', () => { pipe = null })
        socket.on('error', () => { })
        resolve(true)
      })
      socket.on('error', () => {
        try { socket.destroy() } catch { /* ignore */ }
        if (left > 0) setTimeout(() => attempt(left - 1), 150)
        else resolve(false)
      })
    }
    attempt(retries)
  })
}

async function observeProps(names) {
  for (const name of names) {
    if (observedProps.has(name)) continue
    const res = await send(['observe_property', ++requestId, name])
    if (res && !res.error) observedProps.add(name)
  }
}

/**
 * 启动 mpv 并嵌入到 hostWindow。
 * @param {object} opts
 * @param {import('electron').BrowserWindow} opts.hostWindow 承载视频像素的窗口（其 HWND 交给 --wid）
 * @param {string} opts.file 媒体路径
 * @param {number} [opts.startAt] 断点续播秒数
 * @param {string[]} [opts.subtitleFiles] 外挂字幕路径
 * @param {number} [opts.volume] 初始音量 0-100
 */
async function start(opts) {
  const mpvPath = resolveMpvPath()
  if (!mpvPath) return { ok: false, error: 'mpv-not-found' }
  if (mpv) await stop()

  const { hostWindow, file, startAt = 0, subtitleFiles = [], volume = 80 } = opts
  const hwnd = hwndOf(hostWindow)

  const args = [
    '--no-config',
    '--no-input-default-bindings',
    '--no-osc',
    '--no-terminal',
    `--input-ipc-server=${PIPE_PATH}`,
    `--wid=${hwnd}`,
    // 真 HDR 直通：libplacebo 输出 + 让显示端知道内容色彩空间
    '--vo=gpu-next',
    '--gpu-api=d3d11',
    '--target-colorspace-hint=yes',
    '--hwdec=auto-safe',
    '--ytdl=no',
    '--keep-open=no',
    '--idle=yes',
    '--force-window=no',
    '--sub-auto=fuzzy',
    '--osd-level=0',
    '--volume=' + Math.round(volume),
    '--msg-level=all=warn'
  ]
  if (startAt > 3) args.push('--start=' + Math.round(startAt))
  for (const s of subtitleFiles) args.push('--sub-file=' + s)
  args.push(file)

  try {
    mpv = spawn(mpvPath, args, { windowsHide: true, stdio: 'ignore', detached: false })
  } catch (e) {
    mpv = null
    return { ok: false, error: String(e) }
  }

  mpv.on('exit', () => {
    mpv = null
    pipe = null
    emit({ ok: false, playing: false, eof: true })
  })
  mpv.on('error', () => {
    mpv = null
    pipe = null
    emit({ ok: false, playing: false })
  })

  const connected = await connectPipe()
  if (!connected) return { ok: false, error: 'mpv-ipc-failed' }

  // 渲染尺寸 / 时长 / 传输状态，全部走 observe_property
  observeProps(['time-pos', 'duration', 'demuxer-cache-time', 'pause', 'volume', 'mute',
    'speed', 'width', 'height', 'eof-reached'])
  await setProp('pause', false)
  emit({ ok: true, playing: true, time: startAt || 0, eof: false })

  return { ok: true, hwnd, pipe: PIPE_PATH }
}

async function stop() {
  if (pipe) {
    try { pipe.write(JSON.stringify({ command: ['quit'] }) + '\n') } catch { /* ignore */ }
  }
  if (mpv) {
    const proc = mpv
    mpv = null
    setTimeout(() => { try { proc.kill() } catch { /* ignore */ } }, 600)
  }
  pipe = null
  pipeBuffer = ''
  observedProps = new Set()
  pending.clear()
  emit({ ok: false, playing: false, time: 0, duration: 0 })
}

/** 统一入口：UI 只发语义化命令，不关心 mpv 的属性名 */
async function command(type, value) {
  switch (type) {
    case 'toggle-play': {
      const res = await send(['get_property', 'pause'])
      const paused = res && res.data === true
      await setProp('pause', !paused)
      emit({ playing: paused })
      return true
    }
    case 'play': await setProp('pause', false); emit({ playing: true }); return true
    case 'pause': await setProp('pause', true); emit({ playing: false }); return true
    case 'seek': await send(['seek', Number(value) || 0, 'absolute']); emit({ time: Number(value) || 0 }); return true
    case 'seek-by': await send(['seek', Number(value) || 0, 'relative']); return true
    case 'volume': await setProp('volume', Math.max(0, Math.min(100, Number(value) || 0))); return true
    case 'mute': await setProp('mute', value === true); return true
    case 'speed': await setProp('speed', Number(value) || 1); return true
    // 画面比例：mpv 用 video-aspect-override 表达 contain/cover/fill
    case 'fit':
      if (value === 'cover') await setProp('video-aspect-override', '-1')
      else await setProp('video-aspect-override', 'no')
      await setProp('video-unscaled', value === 'fill' ? true : false)
      return true
    case 'zoom': await setProp('video-zoom', Math.log2(Math.max(0.2, Number(value) || 1))); return true
    case 'pan':
      await setProp('video-pan-x', Number(value?.x) || 0)
      await setProp('video-pan-y', Number(value?.y) || 0)
      return true
    case 'brightness': await setProp('brightness', Math.round((Number(value) - 1) * 50)); return true
    case 'sub-add': if (value) await send(['sub-add', value, 'select']); return true
    case 'sub-remove': await send(['sub-remove']); return true
    case 'sub-visibility': await setProp('sub-visibility', value === true); return true
    case 'sub-size': await setProp('sub-font-size', Math.max(12, Math.min(120, Number(value) || 55))); return true
    case 'sub-pos': await setProp('sub-pos', Math.max(0, Math.min(150, Number(value) || 92))); return true
    case 'sub-track': await setProp('sid', value === 'no' ? 'no' : Number(value)); return true
    case 'get-tracks': {
      const res = await send(['get_property', 'track-list'])
      const list = Array.isArray(res?.data) ? res.data : []
      return list.map((t) => ({ id: t.id, type: t.type, lang: t.lang || '', title: t.title || '', selected: !!t.selected }))
    }
    case 'get-props': {
      const res = await send(['get_property', 'pause'])
      return { paused: res?.data === true }
    }
    case 'screenshot': {
      if (!value) return false
      // mpv 在文件已卸载（EOF + idle）时没有帧可截，命令会静默失败；等落盘再判断，避免 UI 假报成功
      try { if (fs.existsSync(value)) fs.unlinkSync(value) } catch { /* 无所谓 */ }
      await send(['screenshot-to-file', value, 'video'])
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 100))
        try { if (fs.existsSync(value) && fs.statSync(value).size > 0) return true } catch { /* 还在写 */ }
      }
      return false
    }
    case 'sub-delay': await setProp('sub-delay', Number(value) || 0); return true
    case 'osd-message': await send(['show-text', String(value || ''), 900]); return true
    case 'get-state': return currentState
    default: return false
  }
}

module.exports = { isMpvAvailable, resolveMpvPath, start, stop, command, onState, getState: () => currentState }
