/**
 * The only bridge between the simulator UI and the file system. Everything the
 * renderer can do is listed here, and it is all funnelled through IPC: the
 * renderer gets no direct Node access, and neither does any designer app.
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('planchette', {
  listApps: () => ipcRenderer.invoke('apps:list'),
  workspacePath: () => ipcRenderer.invoke('workspace:path'),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  reveal: (appId) => ipcRenderer.invoke('workspace:reveal', appId),
  createApp: (name) => ipcRenderer.invoke('apps:create', name),

  onAppsChanged: (cb) => ipcRenderer.on('apps:changed', (_e, appId) => cb(appId)),
  onReloadApp: (cb) => ipcRenderer.on('app:reload', () => cb()),
  onChooseWorkspace: (cb) => ipcRenderer.on('app:choose-workspace', () => cb()),

  version: process.versions.electron,
})
