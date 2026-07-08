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
  setFullScreen: (value: boolean) => ipcRenderer.invoke('window:setFullScreen', value),
  toggleFullScreen: () => ipcRenderer.invoke('window:toggleFullScreen'),
  getEmbeddingStatus: () => ipcRenderer.invoke('embedding:status'),
  ensureEmbedding: () => ipcRenderer.invoke('embedding:ensure'),
  stopEmbedding: () => ipcRenderer.invoke('embedding:stop'),
  listModels: () => ipcRenderer.invoke('models:list'),
  selectModel: (modelPath: string) => ipcRenderer.invoke('models:select', modelPath),
  ejectModel: () => ipcRenderer.invoke('models:eject'),
  ensureLlama: () => ipcRenderer.invoke('llama:ensure'),
  getLlamaStatus: () => ipcRenderer.invoke('llama:status'),
  fetchLlamaReleases: () => ipcRenderer.invoke('llama:releases'),
  installLlamaServer: (variant: unknown) => ipcRenderer.invoke('llama:install', variant),
  cancelLlamaInstall: () => ipcRenderer.invoke('llama:install-cancel'),
  onLlamaInstallProgress: (callback: (payload: unknown) => void) => subscribe('llama:install-progress', callback),
  onSystemResources: (callback: (payload: unknown) => void) => subscribe('system:resources', callback),
  pickFolder: (title?: string) => ipcRenderer.invoke('dialog:pickFolder', title),
  loadUiSettings: () => ipcRenderer.invoke('uiSettings:load'),
  saveUiSettings: (settings: unknown) => ipcRenderer.invoke('uiSettings:save', settings)
})
