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

  winMin: () => ipcRenderer.send('win-min'),
  winMax: () => ipcRenderer.send('win-max'),
  winClose: () => ipcRenderer.send('win-close')
})
