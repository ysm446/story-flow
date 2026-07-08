import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

function subscribe(channel: string, callback: (payload: unknown) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: unknown) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.off(channel, listener)
}

contextBridge.exposeInMainWorld('storyFlow', {
  bootstrap: () => ipcRenderer.invoke('bootstrap'),
  getBackendStatus: () => ipcRenderer.invoke('backend:status'),
  ensureBackend: () => ipcRenderer.invoke('backend:ensure'),
  listModels: () => ipcRenderer.invoke('models:list'),
  selectModel: (modelPath: string) => ipcRenderer.invoke('models:select', modelPath),
  ejectModel: () => ipcRenderer.invoke('models:eject'),
  ensureLlama: () => ipcRenderer.invoke('llama:ensure'),
  getLlamaStatus: () => ipcRenderer.invoke('llama:status'),
  fetchLlamaReleases: () => ipcRenderer.invoke('llama:releases'),
  installLlamaServer: (variant: unknown) => ipcRenderer.invoke('llama:install', variant),
  cancelLlamaInstall: () => ipcRenderer.invoke('llama:install-cancel'),
  onLlamaInstallProgress: (callback: (payload: unknown) => void) => subscribe('llama:install-progress', callback)
})
