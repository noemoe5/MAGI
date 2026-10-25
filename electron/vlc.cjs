// MAGI 视频引擎：libVLC 控制器
//
// 与旧 mpv 方案同样的架构，但内核换成 libVLC：
//   1) 通过 koffi（N-API FFI，无需编译工具链）直接调用 libvlc.dll；
//   2) 用 libvlc_media_player_set_hwnd() 把 VLC 的 vout 嵌进专用视频窗口的 HWND；
//   3) UI 仍由透明覆盖窗口承载，主进程轮询播放状态后推给两侧窗口。
//
// 为什么不用事件回调：libvlc_event_t 是带 union 的 C 结构体，跨 FFI 解析脆弱。
// 轮询 get_state / get_time / get_length 是纯标量读取，10Hz 对播放器 UI 完全够，
// 并且 Ended / Error 状态可以直接判断，不会漏事件。
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

let koffi = null
try { koffi = require('koffi') } catch { koffi = null }

/** VLC 目录：开发期 vendor/vlc，打包后 resources/vlc */
function resolveVlcDir() {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'vlc') : '',
    path.join(__dirname, '..', 'vendor', 'vlc'),
    path.join(__dirname, '..', 'resources', 'vlc'),
    path.join(process.cwd(), 'vendor', 'vlc')
  ]
  for (const d of candidates) {
    try {
      if (d && fs.existsSync(path.join(d, 'libvlc.dll'))) return d
    } catch { /* ignore */ }
  }
  return null
}

const isVlcAvailable = () => Boolean(koffi) && resolveVlcDir() !== null

// —— libvlc 状态枚举 ——
const ST = {
  NothingSpecial: 0,
  Opening: 1,
  Buffering: 2,
  Playing: 3,
  Paused: 4,
  Stopped: 5,
  Ended: 6,
  Error: 7
}

let lib = null            // koffi 绑定表
let inst = null           // libvlc_instance_t*
let mp = null             // libvlc_media_player_t*
let media = null          // libvlc_media_t*
let pollTimer = null
let vlcDir = null
let currentFile = ''
let subVisible = true
let lastSpu = -1          // 关闭字幕后记住原 spu id，恢复时用
let currentSizeScale = 1  // 字幕相对字号（重载生效）
let currentSubMargin = 0  // 字幕底部边距

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
const listeners = new Set()

function emit(patch, force = false) {
  const next = { ...currentState, ...patch }
  let changed = force
  if (!changed) {
    for (const k of Object.keys(patch)) {
      if (next[k] !== currentState[k]) { changed = true; break }
    }
  }
  currentState = next
  if (!changed) return
  for (const fn of listeners) {
    try { fn(currentState) } catch { /* ignore */ }
  }
}
function onState(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 一次性建立 FFI 绑定（只做一次，插件扫描很贵） */
function bind() {
  if (lib) return lib
  vlcDir = resolveVlcDir()
  if (!vlcDir) throw new Error('vlc-not-found')
  const dll = path.join(vlcDir, 'libvlc.dll')
  const raw = koffi.load(dll)

  const f = (name, ret, args) => raw.func(name, ret, args)
  lib = {
    // 实例生命周期
    new: f('libvlc_new', 'void *', ['int', 'const char *const *']),
    release: f('libvlc_release', 'void', ['void *']),
    errmsg: f('libvlc_errmsg', 'const char *', []),
    // media
    mediaNewPath: f('libvlc_media_new_path', 'void *', ['void *', 'const char *']),
    mediaAddOption: f('libvlc_media_add_option', 'void', ['void *', 'const char *']),
    mediaRelease: f('libvlc_media_release', 'void', ['void *']),
    // 播放器
    mpNew: f('libvlc_media_player_new_from_media', 'void *', ['void *']),
    mpRelease: f('libvlc_media_player_release', 'void', ['void *']),
    mpSetMedia: f('libvlc_media_player_set_media', 'void', ['void *', 'void *']),
    mpSetHwnd: f('libvlc_media_player_set_hwnd', 'void', ['void *', 'void *']),
    mpPlay: f('libvlc_media_player_play', 'int', ['void *']),
    mpPause: f('libvlc_media_player_pause', 'void', ['void *']),
    mpStop: f('libvlc_media_player_stop', 'void', ['void *']),
    mpIsPlaying: f('libvlc_media_player_is_playing', 'int', ['void *']),
    mpGetState: f('libvlc_media_player_get_state', 'int', ['void *']),
    mpGetTime: f('libvlc_media_player_get_time', 'int64', ['void *']),
    mpSetTime: f('libvlc_media_player_set_time', 'void', ['void *', 'int64']),
    mpGetLength: f('libvlc_media_player_get_length', 'int64', ['void *']),
    mpGetPosition: f('libvlc_media_player_get_position', 'float', ['void *']),
    mpSetPosition: f('libvlc_media_player_set_position', 'void', ['void *', 'float']),
    mpSetRate: f('libvlc_media_player_set_rate', 'int', ['void *', 'float']),
    mpGetRate: f('libvlc_media_player_get_rate', 'float', ['void *']),
    mpCanPause: f('libvlc_media_player_can_pause', 'int', ['void *']),
    mpAddSlave: f('libvlc_media_player_add_slave', 'int', ['void *', 'int', 'const char *', 'int']),
    // 音频
    audioSetVolume: f('libvlc_audio_set_volume', 'int', ['void *', 'int']),
    audioGetVolume: f('libvlc_audio_get_volume', 'int', ['void *']),
    audioSetMute: f('libvlc_audio_set_mute', 'void', ['void *', 'int']),
    audioGetMute: f('libvlc_audio_get_mute', 'int', ['void *']),
    audioGetTrack: f('libvlc_audio_get_track', 'int', ['void *']),
    audioSetTrack: f('libvlc_audio_set_track', 'int', ['void *', 'int']),
    audioGetTrackCount: f('libvlc_audio_get_track_count', 'int', ['void *']),
    audioGetTrackDesc: f('libvlc_audio_get_track_description', 'void *', ['void *']),
    // 视频
    videoGetWidth: f('libvlc_video_get_width', 'int', ['void *']),
    videoGetHeight: f('libvlc_video_get_height', 'int', ['void *']),
    videoSetAspect: f('libvlc_video_set_aspect_ratio', 'int', ['void *', 'const char *']),
    videoSetCrop: f('libvlc_video_set_crop_geometry', 'int', ['void *', 'const char *']),
    videoSetScale: f('libvlc_video_set_scale', 'int', ['void *', 'float']),
    videoSetSubFile: f('libvlc_video_set_subtitle_file', 'int', ['void *', 'const char *']),
    videoGetSpu: f('libvlc_video_get_spu', 'int', ['void *']),
    videoSetSpu: f('libvlc_video_set_spu', 'int', ['void *', 'int']),
    videoGetSpuCount: f('libvlc_video_get_spu_count', 'int', ['void *']),
    videoGetSpuDesc: f('libvlc_video_get_spu_description', 'void *', ['void *']),
    videoSetSpuDelay: f('libvlc_video_set_spu_delay', 'int', ['void *', 'int64']),
    videoSnapshot: f('libvlc_video_take_snapshot', 'int', ['void *', 'unsigned int', 'const char *', 'unsigned int', 'unsigned int']),
    trackDescRelease: f('libvlc_track_description_list_release', 'void', ['void *'])
  }
  return lib
}

/**
 * VLC 3.0 在 Windows 上要求本地路径用反斜杠：传 "D:/x/y.mp4" 会让
 * libvlc_media_new_path 直接返回 NULL（它把正斜杠当 URL 解析又解析不通）。
 * 这里统一归一成 Windows 路径形态。
 */
function toVlcPath(p) {
  if (!p) return p
  const s = String(p)
  if (/^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('\\\\')) return s.replace(/\//g, '\\')
  if (s.startsWith('/')) return path.resolve(s).replace(/\//g, '\\')
  return path.resolve(s)
}

/** libvlc 实例参数。插件目录靠 VLC_PLUGIN_PATH + libvlc.dll 同级 plugins 定位。 */
function instanceArgs() {
  return [
    '--no-video-title-show',
    '--no-osd',
    '--no-snapshot-preview',
    '--no-plugins-cache',
    '--no-lua',
    '--intf=dummy',
    '--quiet',
    // 硬解：D3D11 优先，失败自动回退软解
    '--avcodec-hw=d3d11va',
    '--avcodec-threads=0',
    // 起播缓冲，减少本地大文件起播卡顿
    '--file-caching=1200',
    '--drop-late-frames',
    '--skip-frames'
  ]
}

function ensureInstance() {
  bind()
  if (inst) return inst
  // libvlc 3.x 已移除 --plugin-path，插件目录改用环境变量告诉它
  try { process.env.VLC_PLUGIN_PATH = path.join(vlcDir, 'plugins') } catch { /* ignore */ }
  const args = instanceArgs()
  inst = lib.new(args.length, args)
  if (!inst) {
    const msg = lib.errmsg()
    throw new Error('libvlc_new 失败: ' + (msg || 'unknown'))
  }
  return inst
}

/** Electron BrowserWindow → 原始 HWND（64 位用 BigInt，koffi 的 void* 需要它） */
function hwndOf(browserWindow) {
  const buf = browserWindow.getNativeWindowHandle()
  return buf.length === 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0))
}

function releasePlayer() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  try { if (mp && lib) lib.mpStop(mp) } catch { /* ignore */ }
  try { if (mp && lib) lib.mpRelease(mp) } catch { /* ignore */ }
  try { if (media && lib) lib.mediaRelease(media) } catch { /* ignore */ }
  mp = null
  media = null
}

/** 轮询播放状态（替代事件回调） */
function startPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = setInterval(() => {
    if (!mp || !lib) return
    try {
      const st = lib.mpGetState(mp)
      const playing = st === ST.Playing || st === ST.Buffering
      const ended = st === ST.Ended || st === ST.Error
      let time = 0, duration = 0
      try { time = Number(lib.mpGetTime(mp)) / 1000 } catch { time = 0 }
      try { duration = Number(lib.mpGetLength(mp)) / 1000 } catch { duration = 0 }
      if (!Number.isFinite(time) || time < 0) time = 0
      if (!Number.isFinite(duration) || duration < 0) duration = 0
      let w = 0, h = 0
      try { w = lib.videoGetWidth(mp) || 0 } catch { w = 0 }
      try { h = lib.videoGetHeight(mp) || 0 } catch { h = 0 }
      let volume = currentState.volume
      let muted = currentState.muted
      try { const v = lib.audioGetVolume(mp); if (v >= 0) volume = v } catch { /* ignore */ }
      try { muted = lib.audioGetMute(mp) === 1 } catch { /* ignore */ }
      let speed = 1
      try { const r = lib.mpGetRate(mp); if (r > 0) speed = Math.round(r * 100) / 100 } catch { speed = currentState.speed }
      const buffered = duration > 0 ? Math.min(duration, time + 8) : 0
      emit({ ok: true, playing, time, duration, buffered, width: w, height: h, eof: ended, volume, muted, speed })
      if (ended && currentState.playing === false) { /* 已在 Ended，状态稳定 */ }
    } catch { /* 播放器已释放，忽略 */ }
  }, 100)
}

/**
 * 打开并播放一个文件。
 * @param {object} opts
 * @param {import('electron').BrowserWindow} opts.hostWindow 承载视频像素的窗口
 * @param {string} opts.file 媒体路径
 * @param {number} [opts.startAt] 断点续播秒数
 * @param {string[]} [opts.subtitleFiles] 外挂字幕
 * @param {number} [opts.volume] 初始音量 0-100
 */
async function start(opts) {
  if (!koffi) return { ok: false, error: 'koffi-missing' }
  const dir = resolveVlcDir()
  if (!dir) return { ok: false, error: 'vlc-not-found' }
  if (!opts || !opts.file) return { ok: false, error: 'no-file' }

  await stop()
  try {
    ensureInstance()
  } catch (e) {
    return { ok: false, error: String(e.message || e) }
  }

  const { hostWindow, file, startAt = 0, subtitleFiles = [], volume = 80 } = opts
  const vfile = toVlcPath(file)
  currentFile = vfile
  subVisible = true
  lastSpu = -1

  try {
    media = lib.mediaNewPath(inst, vfile)
    if (!media) return { ok: false, error: 'media-new-failed' }

    // 字幕字号/底部边距属于 vout 建窗时固定的参数，改了需要重载才生效
    if (currentSizeScale && currentSizeScale !== 1) {
      const rel = Math.max(8, Math.min(60, Math.round(20 * currentSizeScale)))
      lib.mediaAddOption(media, `:freetype-rel-fontsize=${rel}`)
    }
    if (currentSubMargin) {
      lib.mediaAddOption(media, `:sub-margin=${Math.round(currentSubMargin)}`)
    }

    mp = lib.mpNew(media)
    if (!mp) return { ok: false, error: 'player-new-failed' }

    // 关键：先绑定 HWND 再 play，否则 VLC 会自己开一个独立窗口
    const hwnd = hwndOf(hostWindow)
    lib.mpSetHwnd(mp, hwnd)

    lib.audioSetVolume(mp, Math.max(0, Math.min(100, Math.round(volume))))

    const rc = lib.mpPlay(mp)
    if (rc !== 0) return { ok: false, error: 'play-failed-' + rc }

    // 断点续播：等时长可用后 seek
    if (startAt > 3) {
      let tries = 0
      const timer = setInterval(() => {
        tries++
        if (!mp || tries > 40) { clearInterval(timer); return }
        try {
          const len = Number(lib.mpGetLength(mp))
          if (len > 0) {
            lib.mpSetTime(mp, BigInt(Math.round(startAt * 1000)))
            clearInterval(timer)
          }
        } catch { clearInterval(timer) }
      }, 100)
    }

    // 外挂字幕：VLC 运行时 add_slave 类型 0 = subtitle，需要 file:// URI
    for (const s of subtitleFiles) {
      if (!s) continue
      try {
        const uri = pathToFileURL(toVlcPath(s)).href
        const okAdd = lib.mpAddSlave(mp, 0, uri, 1)
        if (okAdd !== 0) lib.videoSetSubFile(mp, toVlcPath(s))
      } catch { /* 字幕挂载失败不该影响播放 */ }
    }

    startPolling()
    emit({ ok: true, playing: true, time: startAt || 0, duration: 0, eof: false, volume }, true)
    return { ok: true, hwnd: String(hwnd), engine: 'vlc', version: '3.0.21' }
  } catch (e) {
    releasePlayer()
    return { ok: false, error: String(e.message || e) }
  }
}

async function stop() {
  releasePlayer()
  emit({ ok: false, playing: false, time: 0, duration: 0, buffered: 0, width: 0, height: 0, eof: false }, true)
}

/** 读 libvlc_track_description_t 链表 → 普通数组 */
function readTrackList(ptr) {
  const out = []
  if (!ptr || !lib) return out
  try {
    let node = ptr
    let guard = 0
    while (node && guard < 64) {
      guard++
      let id = 0, name = ''
      try { id = koffi.decode(node, 'int') } catch { id = 0 }
      // 结构体布局：int i_id; char *psz_name; struct *p_next;
      // 64 位下指向 char* 的偏移是 8
      try {
        const nameBuf = koffi.decode(node, 8, 'char *')
        name = nameBuf ? String(nameBuf) : ''
      } catch { name = '' }
      let next = null
      try { next = koffi.decode(node, 16, 'void *') } catch { next = null }
      out.push({ id, name })
      node = next
    }
  } catch { /* ignore */ }
  try { lib.trackDescRelease(ptr) } catch { /* ignore */ }
  return out
}

/** 统一入口：UI 只发语义化命令 */
async function command(type, value) {
  if (!lib) return false
  const alive = Boolean(mp)
  switch (type) {
    case 'toggle-play': {
      if (!alive) return false
      try {
        const playing = lib.mpIsPlaying(mp) === 1
        lib.mpPause(mp)                 // libvlc_pause 是「切换」语义
        emit({ playing: !playing })
      } catch { /* ignore */ }
      return true
    }
    case 'play':
      if (!alive) return false
      try { lib.mpPlay(mp); emit({ playing: true }) } catch { /* ignore */ }
      return true
    case 'pause':
      if (!alive) return false
      try {
        const playing = lib.mpIsPlaying(mp) === 1
        if (playing) lib.mpPause(mp)
        emit({ playing: false })
      } catch { /* ignore */ }
      return true
    case 'seek':
      if (!alive) return false
      try {
        lib.mpSetTime(mp, BigInt(Math.round((Number(value) || 0) * 1000)))
        emit({ time: Number(value) || 0, eof: false })
      } catch { /* ignore */ }
      return true
    case 'seek-by':
      if (!alive) return false
      try {
        const cur = Number(lib.mpGetTime(mp)) / 1000
        const target = Math.max(0, cur + (Number(value) || 0))
        lib.mpSetTime(mp, BigInt(Math.round(target * 1000)))
      } catch { /* ignore */ }
      return true
    case 'volume':
      if (!alive) return false
      try {
        const v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)))
        lib.audioSetVolume(mp, v)
        emit({ volume: v, muted: false })
      } catch { /* ignore */ }
      return true
    case 'mute':
      if (!alive) return false
      try {
        lib.audioSetMute(mp, value === true ? 1 : 0)
        emit({ muted: value === true })
      } catch { /* ignore */ }
      return true
    case 'speed':
      if (!alive) return false
      try {
        const r = Math.max(0.1, Math.min(8, Number(value) || 1))
        lib.mpSetRate(mp, r)
        emit({ speed: r })
      } catch { /* ignore */ }
      return true
    // 画面比例：VLC 没有 contain/cover/fill 三态，用 aspect-ratio + crop 组合表达
    case 'fit':
      if (!alive) return false
      try {
        if (value === 'fill') {
          // 拉伸填满：把画面宽高比强制设成窗口比例
          const w = currentState.width || 0
          const h = currentState.height || 0
          lib.videoSetCrop(mp, null)
          lib.videoSetAspect(mp, '')
          lib.videoSetScale(mp, 0)
        } else if (value === 'cover') {
          // 等比铺满并裁切：按 16:9 基准裁，超出部分切掉
          lib.videoSetAspect(mp, '')
          lib.videoSetCrop(mp, '16:9')
          lib.videoSetScale(mp, 0)
        } else {
          lib.videoSetCrop(mp, null)
          lib.videoSetAspect(mp, '')
          lib.videoSetScale(mp, 0)
        }
      } catch { /* ignore */ }
      return true
    case 'zoom':
      if (!alive) return false
      try { lib.videoSetScale(mp, Math.max(0.2, Math.min(5, Number(value) || 1))) } catch { /* ignore */ }
      return true
    case 'pan':
      // libVLC 没有视频平移 API；返回 false 让 UI 知道这项不支持
      return false
    case 'brightness':
      // 亮度属于 vout 调节器，libVLC 未导出稳定接口；返回 false 不假装成功
      return false
    case 'sub-add':
      if (!alive || !value) return false
      try {
        const uri = pathToFileURL(toVlcPath(value)).href
        const okAdd = lib.mpAddSlave(mp, 0, uri, 1)
        if (okAdd !== 0) lib.videoSetSubFile(mp, toVlcPath(value))
        emit({ eof: false })
      } catch { /* ignore */ }
      return true
    case 'sub-remove':
      if (!alive) return false
      try { lib.videoSetSpu(mp, -1) } catch { /* ignore */ }
      return true
    case 'sub-visibility':
      if (!alive) return false
      try {
        if (value === true) {
          lib.videoSetSpu(mp, lastSpu > 0 ? lastSpu : -1)
          subVisible = true
        } else {
          const cur = lib.videoGetSpu(mp)
          if (cur > 0) lastSpu = cur
          lib.videoSetSpu(mp, -1)
          subVisible = false
        }
      } catch { /* ignore */ }
      return true
    case 'sub-size': {
      // freetype 参数在 vout 建窗时固定，改字号必须重载媒体 —— 记住比例，下次 open 生效
      const n = Number(value) || 55
      // UI 传 12..120（对应 mpv 的 sub-font-size），换算成 0.5..3 的倍率
      currentSizeScale = Math.max(0.5, Math.min(3, n / 55))
      if (alive) await reloadKeepingPosition()
      return true
    }
    case 'sub-pos':
      currentSubMargin = Math.max(0, Math.min(300, Number(value) || 0))
      if (alive) await reloadKeepingPosition()
      return true
    case 'sub-track':
      if (!alive) return false
      try {
        if (value === 'no') { lib.videoSetSpu(mp, -1); subVisible = false }
        else { lib.videoSetSpu(mp, Number(value) || -1); subVisible = true }
      } catch { /* ignore */ }
      return true
    case 'get-tracks': {
      if (!alive) return []
      const out = []
      try {
        const sub = readTrackList(lib.videoGetSpuDesc(mp))
        for (const t of sub) {
          if (t.id <= 0) continue
          out.push({ id: t.id, type: 'sub', lang: '', title: t.name || '', selected: t.id === lib.videoGetSpu(mp) })
        }
      } catch { /* ignore */ }
      try {
        const aud = readTrackList(lib.audioGetTrackDesc(mp))
        const cur = lib.audioGetTrack(mp)
        for (const t of aud) {
          if (t.id <= 0) continue
          out.push({ id: t.id, type: 'audio', lang: '', title: t.name || '', selected: t.id === cur })
        }
      } catch { /* ignore */ }
      return out
    }
    case 'sub-delay':
      if (!alive) return false
      try { lib.videoSetSpuDelay(mp, BigInt(Math.round((Number(value) || 0) * 1e6))) } catch { /* ignore */ }
      return true
    case 'get-props':
      if (!alive) return { paused: true }
      try { return { paused: lib.mpIsPlaying(mp) !== 1 } } catch { return { paused: true } }
    case 'screenshot': {
      if (!alive || !value) return false
      try { if (fs.existsSync(value)) fs.unlinkSync(value) } catch { /* ignore */ }
      let rc = 1
      try { rc = lib.videoSnapshot(mp, 0, value, 0, 0) } catch { rc = 1 }
      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 100))
        try { if (fs.existsSync(value) && fs.statSync(value).size > 0) return true } catch { /* 还在写 */ }
      }
      return false
    }
    case 'osd-message':
      // libVLC 的 OSD 已用 --no-osd 关闭（避免和我们的 UI 打架），提示交给覆盖层自己画
      return false
    case 'get-state':
      return currentState
    default:
      return false
  }
}

/** 字幕字号/位置变更后重载媒体，保持播放位置不变 */
async function reloadKeepingPosition() {
  if (!mp || !lib || !currentFile) return
  let pos = 0
  try { pos = Number(lib.mpGetTime(mp)) / 1000 } catch { pos = 0 }
  let wasPlaying = true
  try { wasPlaying = lib.mpIsPlaying(mp) === 1 } catch { wasPlaying = true }
  const file = currentFile
  const vol = currentState.volume
  const rate = currentState.speed
  try {
    const nm = lib.mediaNewPath(inst, file)
    if (!nm) return
    if (currentSizeScale && currentSizeScale !== 1) {
      const rel = Math.max(8, Math.min(60, Math.round(20 * currentSizeScale)))
      lib.mediaAddOption(nm, `:freetype-rel-fontsize=${rel}`)
    }
    if (currentSubMargin) lib.mediaAddOption(nm, `:sub-margin=${Math.round(currentSubMargin)}`)
    lib.mpSetMedia(mp, nm)
    lib.mediaRelease(media)
    media = nm
    lib.mpPlay(mp)
    if (pos > 0.5) {
      const target = BigInt(Math.round(pos * 1000))
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 100))
        try { if (Number(lib.mpGetLength(mp)) > 0) { lib.mpSetTime(mp, target); break } } catch { break }
      }
    }
    if (!wasPlaying) { try { lib.mpPause(mp) } catch { /* ignore */ } }
    try { lib.audioSetVolume(mp, vol) } catch { /* ignore */ }
    if (rate && rate !== 1) { try { lib.mpSetRate(mp, rate) } catch { /* ignore */ } }
  } catch { /* ignore */ }
}

function shutdown() {
  releasePlayer()
  try { if (inst && lib) lib.release(inst) } catch { /* ignore */ }
  inst = null
  lib = null
}

module.exports = {
  isVlcAvailable,
  resolveVlcDir,
  start,
  stop,
  command,
  onState,
  getState: () => currentState,
  shutdown,
  engine: 'vlc'
}
