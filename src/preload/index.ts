import { contextBridge, ipcRenderer } from 'electron'

const api = {
  pty: {
    create: (id: string, cwd?: string) => ipcRenderer.invoke('pty:create', { id, cwd }),
    write: (id: string, data: string) => ipcRenderer.invoke('pty:write', { id, data }),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke('pty:resize', { id, cols, rows }),
    kill: (id: string) => ipcRenderer.invoke('pty:kill', { id }),
    onData: (id: string, cb: (data: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: string) => cb(data)
      ipcRenderer.on(`pty:data:${id}`, handler)
      return () => ipcRenderer.removeListener(`pty:data:${id}`, handler)
    },
    onExit: (id: string, cb: (code: number) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, code: number) => cb(code)
      ipcRenderer.on(`pty:exit:${id}`, handler)
      return () => ipcRenderer.removeListener(`pty:exit:${id}`, handler)
    }
  },
  dialog: {
    selectFolder: (title?: string) => ipcRenderer.invoke('dialog:selectFolder', { title })
  },
  data: {
    load: () => ipcRenderer.invoke('data:load'),
    save: (data: Record<string, unknown>) => ipcRenderer.invoke('data:save', data)
  },
  fs: {
    hasGit: (path: string) => ipcRenderer.invoke('fs:hasGit', { path })
  },
  project: {
    scan: (zones: { path: string; type: string }[]) => ipcRenderer.invoke('project:scan', { zones })
  },
  skills: {
    scan: () => ipcRenderer.invoke('skills:scan'),
    link: (cwd: string, skillPaths: string[]) => ipcRenderer.invoke('skills:link', { cwd, skillPaths })
  },
  agent: {
    setupHooks: (cwd: string, agentId: string) => ipcRenderer.invoke('agent:setupHooks', { cwd, agentId }),
    loadLogs: (agentId: string) => ipcRenderer.invoke('agent:loadLogs', { agentId }),
    onStatus: (cb: (data: { agentId: string; status: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { agentId: string; status: string }) => cb(data)
      ipcRenderer.on('agent:status', handler)
      return () => ipcRenderer.removeListener('agent:status', handler)
    },
    onReport: (cb: (data: { agentId: string; type: string; items: { text: string; done: boolean }[] }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => cb(data)
      ipcRenderer.on('agent:report', handler)
      return () => ipcRenderer.removeListener('agent:report', handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
