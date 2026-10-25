const { contextBridge, ipcRenderer } = require('electron')

// 媒体服务器基址由主进程 listen 就绪后推送，缓存于此供渲染进程同步读取
let mediaBase = ''
ipcRenderer.on('media-base-url', (_e, url) => { mediaBase = url })

contextBridge.exposeInMainWorld('electronAPI', {
  openFiles: () => ipcRenderer.invoke('open-files'),
  // 打开书：epub 返回 { kind:'epub', baseUrl:'http://127.0.0.1:<port>/<id>/' }（目录加载，支持大文件）；
  // txt 返回 { kind:'txt', text }。取代原先整包读 base64 的方式。
  openBook: (p) => ipcRenderer.invoke('open-book', p),
  readFile: (p) => ipcRenderer.invoke('read-file', p),
  readLibrary: () => ipcRenderer.invoke('read-library'),
  writeLibrary: (data) => ipcRenderer.invoke('write-library', data),
  getPath: () => ipcRenderer.invoke('get-path'),

  // —— 界面语言包（往 languages 目录丢 json 即新增语言）——
  langList: () => ipcRenderer.invoke('lang-list'),
  langOpenDir: () => ipcRenderer.invoke('lang-open-dir'),

  // —— 文献查阅 ——
  lookupFetch: (url) => ipcRenderer.invoke('lookup-fetch', url),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openJson: () => ipcRenderer.invoke('open-json'),
  saveJson: (defaultName, content) => ipcRenderer.invoke('save-json', defaultName, content),

  // —— 媒体（音频/视频）——
  openMediaFiles: (kind) => ipcRenderer.invoke('open-media-files', kind),
  openMediaDir: (kind) => ipcRenderer.invoke('open-media-dir', kind),
  mediaRegister: (paths) => ipcRenderer.invoke('media-register', paths),
  mediaBaseUrl: () => mediaBase,
  mediaProbe: (p) => ipcRenderer.invoke('media-probe', p),
  mediaSidecar: (p) => ipcRenderer.invoke('media-sidecar', p),
  mediaReadText: (p) => ipcRenderer.invoke('media-read-text', p),

  // —— 视频引擎（libVLC 嵌入）——
  // 视频像素画在独立的视频窗口里，控制 UI 在透明覆盖窗口中；两侧都通过这些方法通信。
  vlc: {
    available: () => ipcRenderer.invoke('video-vlc-available'),
    open: (payload) => ipcRenderer.invoke('video-vlc-open', payload),
    command: (type, value) => ipcRenderer.invoke('video-vlc-command', { type, value }),
    close: () => ipcRenderer.invoke('video-vlc-close'),
    fullscreen: (on) => ipcRenderer.invoke('video-vlc-fullscreen', on),
    screenshot: (name) => ipcRenderer.invoke('video-vlc-screenshot', name),
    onInit: (fn) => {
      const h = (_e, payload) => fn(payload)
      ipcRenderer.on('vlc:init', h)
      return () => ipcRenderer.removeListener('vlc:init', h)
    },
    onState: (fn) => {
      const h = (_e, state) => fn(state)
      ipcRenderer.on('vlc:state', h)
      return () => ipcRenderer.removeListener('vlc:state', h)
    },
    onOpened: (fn) => {
      const h = (_e, payload) => fn(payload)
      ipcRenderer.on('vlc:opened', h)
      return () => ipcRenderer.removeListener('vlc:opened', h)
    },
    onClosed: (fn) => {
      const h = () => fn()
      ipcRenderer.on('vlc:closed', h)
      return () => ipcRenderer.removeListener('vlc:closed', h)
    },
    ready: () => ipcRenderer.send('video-vlc-overlay-ready')
  },

  // 覆盖窗口 ↔ 主窗口的语义化事件（队列逻辑在渲染层的 store 里，主进程只做转发）
  videoUiEvent: (name, payload) => ipcRenderer.send('video-ui-event', { name, payload }),
  onVideoUiEvent: (fn) => {
    const h = (_e, evt) => fn(evt)
    ipcRenderer.on('video-ui-event', h)
    return () => ipcRenderer.removeListener('video-ui-event', h)
  },

  winMin: () => ipcRenderer.send('win-min'),
  winMax: () => ipcRenderer.send('win-max'),
  winClose: () => ipcRenderer.send('win-close')
})
