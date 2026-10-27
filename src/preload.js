const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petApi', {
  // 펫 창
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  loadState: () => ipcRenderer.invoke('load-state'),
  saveState: (state) => ipcRenderer.send('save-state', state),
  onCommand: (fn) => ipcRenderer.on('command', (_e, msg) => fn(msg)),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  onDragMove: (fn) => ipcRenderer.on('drag-move', (_e, pt) => fn(pt)),

  // 숏컷
  getShortcuts: () => ipcRenderer.invoke('get-shortcuts'),
  saveShortcuts: (list) => ipcRenderer.invoke('save-shortcuts', list),
  launchShortcut: (id) => ipcRenderer.invoke('launch-shortcut', id),
  pickApp: () => ipcRenderer.invoke('pick-app'),

  // 설정
  openSettings: (tab) => ipcRenderer.send('open-settings', tab),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (patch) => ipcRenderer.invoke('update-settings', patch),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),
  getAppState: () => ipcRenderer.invoke('get-app-state'),
  setAppOption: (key, value) => ipcRenderer.invoke('set-app-option', { key, value }),
  getStatus: () => ipcRenderer.invoke('get-status'),
  petCommand: (cmd) => ipcRenderer.send('pet-command', cmd),
  openDataDir: () => ipcRenderer.send('open-data-dir'),
  onAppState: (fn) => ipcRenderer.on('app-state', (_e, s) => fn(s)),
  onSettingsTab: (fn) => ipcRenderer.on('settings-tab', (_e, tab) => fn(tab)),

  // 업데이트
  getUpdateState: () => ipcRenderer.invoke('get-update-state'),
  checkUpdate: () => ipcRenderer.send('check-update'),
  installUpdate: () => ipcRenderer.send('install-update'),
  onUpdateState: (fn) => ipcRenderer.on('update-state', (_e, s) => fn(s)),
});
