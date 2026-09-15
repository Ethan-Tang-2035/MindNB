import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopAPI } from '../src/vault-format.ts'
const api: DesktopAPI = {
  onAgentRequest(callback) { const listener = (_event: unknown, request: Parameters<typeof callback>[0]) => callback(request); ipcRenderer.on('agent:request', listener); return () => ipcRenderer.removeListener('agent:request', listener) },
  respondAgentRequest: (id, response) => ipcRenderer.send('agent:response', id, response),
  setMenuState: state => ipcRenderer.invoke('desktop:menu-state', state),
  savePageImages: files => ipcRenderer.invoke('desktop:export-pages', files),
  saveExport: request => ipcRenderer.invoke('desktop:export', request),
  onCommand(callback) { const listener = (_event: unknown, command: Parameters<typeof callback>[0]) => callback(command); ipcRenderer.on('desktop:command', listener); return () => ipcRenderer.removeListener('desktop:command', listener) },
  snapshot: () => ipcRenderer.invoke('vault:snapshot'),
  chooseVault: () => ipcRenderer.invoke('vault:choose'),
  save: request => ipcRenderer.invoke('vault:save', request),
  saveView: (id, view) => ipcRenderer.invoke('vault:view', id, view),
  importFile: () => ipcRenderer.invoke('vault:import'),
  permanentlyDelete: id => ipcRenderer.invoke('vault:permanently-delete', id),
  history: id => ipcRenderer.invoke('vault:history', id),
  restore: (id, revision) => ipcRenderer.invoke('vault:restore', id, revision),
  onChanged(callback) { const listener = () => callback(); ipcRenderer.on('vault:changed', listener); return () => ipcRenderer.removeListener('vault:changed', listener) },
  onOpen(callback) { const listener = (_event: unknown, id: string) => callback(id); ipcRenderer.on('vault:open', listener); return () => ipcRenderer.removeListener('vault:open', listener) },
  onFlush(callback) {
    const listener = async (_event: unknown, token: string) => {
      try { await callback(); ipcRenderer.send('vault:flushed', token, null) }
      catch (e) { ipcRenderer.send('vault:flushed', token, e instanceof Error ? e.message : '保存失败') }
    }
    ipcRenderer.on('vault:flush', listener)
    return () => ipcRenderer.removeListener('vault:flush', listener)
  },
}
contextBridge.exposeInMainWorld('mindNBDesktop', api)
