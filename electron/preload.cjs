const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  openFiles: () => ipcRenderer.invoke('open-files'),
  // 打开书：epub 返回 { kind:'epub', baseUrl:'nrbook://<id>' }（目录加载，支持大文件）；
  // txt 返回 { kind:'txt', text }。取代原先整包读 base64 的方式。
  openBook: (p) => ipcRenderer.invoke('open-book', p),
  readFile: (p) => ipcRenderer.invoke('read-file', p),
  readLibrary: () => ipcRenderer.invoke('read-library'),
  writeLibrary: (data) => ipcRenderer.invoke('write-library', data),
  getPath: () => ipcRenderer.invoke('get-path'),
  winMin: () => ipcRenderer.send('win-min'),
  winMax: () => ipcRenderer.send('win-max'),
  winClose: () => ipcRenderer.send('win-close')
})
