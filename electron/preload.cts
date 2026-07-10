import { contextBridge, ipcRenderer, webUtils } from 'electron'

const debugEnabled = process.env.VIEWER_DEBUG === '1'

contextBridge.exposeInMainWorld('viewerApi', {
  debugEnabled,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  debugLog: (message: string, data?: unknown) =>
    ipcRenderer.send('viewer:debug-log', { message, data }),
  selectFolder: () => ipcRenderer.invoke('viewer:select-folder'),
  listFolder: (folderPath: string, options?: { includeDateTaken?: boolean }) =>
    ipcRenderer.invoke('viewer:list-folder', folderPath, options),
  resolveSource: (filePath: string) => ipcRenderer.invoke('viewer:resolve-source', filePath),
  toggleFullscreen: () => ipcRenderer.invoke('viewer:toggle-fullscreen'),
  setFullscreen: (shouldBeFullscreen: boolean) =>
    ipcRenderer.invoke('viewer:set-fullscreen', shouldBeFullscreen),
  getFullscreen: () => ipcRenderer.invoke('viewer:get-fullscreen'),
  onFullscreenChange: (callback: (isFullscreen: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, isFullscreen: boolean) => {
      callback(isFullscreen)
    }

    ipcRenderer.on('viewer:fullscreen-change', listener)
    return () => ipcRenderer.removeListener('viewer:fullscreen-change', listener)
  },
  getStartupTarget: () => ipcRenderer.invoke('viewer:get-startup-target'),
  getSettings: () => ipcRenderer.invoke('viewer:get-settings'),
  updateSettings: (partial: Record<string, unknown>) =>
    ipcRenderer.invoke('viewer:update-settings', partial),
  deleteItem: (filePath: string) => ipcRenderer.invoke('viewer:delete-item', filePath),
  showInFolder: (filePath: string) => ipcRenderer.invoke('viewer:show-in-folder', filePath),
  getThumbnail: (filePath: string) => ipcRenderer.invoke('viewer:get-thumbnail', filePath),
  // Must stay in sync with toMediaUrl in electron/main.ts.
  getMediaUrl: (filePath: string) => `media://local/${encodeURIComponent(filePath)}`,
})
