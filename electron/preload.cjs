/**
 * The only bridge between the simulator UI and the file system. Everything the
 * renderer can do is listed here, and it is all funnelled through IPC: the
 * renderer gets no direct Node access, and neither does any designer app.
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('planchette', {
  listApps: () => ipcRenderer.invoke('apps:list'),
  workspacePath: () => ipcRenderer.invoke('workspace:path'),
  listWorkspaces: () => ipcRenderer.invoke('workspace:list'),
  useWorkspace: (dir) => ipcRenderer.invoke('workspace:use', dir),
  forgetWorkspace: (dir) => ipcRenderer.invoke('workspace:forget', dir),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  reveal: (appId) => ipcRenderer.invoke('workspace:reveal', appId),
  createInterface: (name) => ipcRenderer.invoke('interface:create', name),

  onAppsChanged: (cb) => ipcRenderer.on('apps:changed', (_e, appId) => cb(appId)),
  onReloadApp: (cb) => ipcRenderer.on('app:reload', () => cb()),
  onChooseWorkspace: (cb) => ipcRenderer.on('app:choose-workspace', () => cb()),
  onForgetWorkspace: (cb) => ipcRenderer.on('app:forget-workspace', () => cb()),
  onNewInterface: (cb) => ipcRenderer.on('app:new-interface', () => cb()),
  onOpenSettings: (cb) => ipcRenderer.on('app:settings', () => cb()),
  onToggleInspector: (cb) => ipcRenderer.on('app:toggle-inspector', () => cb()),
  onAbout: (cb) => ipcRenderer.on('app:about', () => cb()),

  version: process.versions.electron,
})
