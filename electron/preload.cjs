const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  openFiles: () => ipcRenderer.invoke('open-files'),
  readFile: (p) => ipcRenderer.invoke('read-file', p),
  readLibrary: () => ipcRenderer.invoke('read-library'),
  writeLibrary: (data) => ipcRenderer.invoke('write-library', data),
  getPath: () => ipcRenderer.invoke('get-path'),
  winMin: () => ipcRenderer.send('win-min'),
  winMax: () => ipcRenderer.send('win-max'),
  winClose: () => ipcRenderer.send('win-close')
})
