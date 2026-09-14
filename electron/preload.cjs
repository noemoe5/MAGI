const { contextBridge, ipcRenderer } = require('electron')

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

  winMin: () => ipcRenderer.send('win-min'),
  winMax: () => ipcRenderer.send('win-max'),
  winClose: () => ipcRenderer.send('win-close')
})
