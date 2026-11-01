const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pawlink', {
  openSettings: () => ipcRenderer.invoke('open-settings'),
  toggleClickThrough: () => ipcRenderer.invoke('toggle-click-through'),
  getProfile: () => ipcRenderer.invoke('get-profile'),
  saveProfile: (profile) => ipcRenderer.invoke('save-profile', profile),
  getModelUrl: () => ipcRenderer.invoke('get-model-url'),
  askPet: (message) => ipcRenderer.invoke('ask-pet', message),
  pickPhoto: () => ipcRenderer.invoke('pick-photo'),
  saveApiKey: (key) => ipcRenderer.invoke('save-api-key', key),
  generateModel: (dataUri) => ipcRenderer.invoke('generate-model', dataUri),
  restoreInteraction: () => ipcRenderer.invoke('restore-interaction'),
  dragStart: (point) => ipcRenderer.send('drag-start', point),
  dragMove: (point) => ipcRenderer.send('drag-move', point),
  dragEnd: () => ipcRenderer.send('drag-end'),
  onProfile: (callback) => ipcRenderer.on('profile-updated', (_, profile) => callback(profile)),
  onModel: (callback) => ipcRenderer.on('model-ready', (_, url) => callback(url)),
  onProgress: (callback) => ipcRenderer.on('model-progress', (_, progress) => callback(progress)),
  onClickThrough: (callback) => ipcRenderer.on('click-through-changed', (_, enabled) => callback(enabled))
});
