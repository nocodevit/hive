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
    hasGit: (path: string) => ipcRenderer.invoke('fs:hasGit', { path }),
    scanFiles: (dirPath: string, limit?: number) => ipcRenderer.invoke('fs:scanFiles', { dirPath, limit }),
    revealInFinder: (filePath: string) => ipcRenderer.invoke('fs:revealInFinder', { filePath }),
    readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', { filePath }) as Promise<string | null>,
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', { filePath, content }) as Promise<boolean>
  },
  git: {
    worktreeAdd: (repoPath: string, agentId: string, agentName: string) =>
      ipcRenderer.invoke('git:worktreeAdd', { repoPath, agentId, agentName }),
    worktreeRemove: (repoPath: string, worktreePath: string) =>
      ipcRenderer.invoke('git:worktreeRemove', { repoPath, worktreePath }),
    worktreeList: (repoPath: string) =>
      ipcRenderer.invoke('git:worktreeList', { repoPath }),
    clone: (url: string, destPath: string, token?: string, provider?: string) =>
      ipcRenderer.invoke('git:clone', { url, destPath, token, provider }) as Promise<{ ok: boolean; path?: string; name?: string; error?: string }>
  },
  project: {
    scan: (zones: { path: string; type: string }[]) => ipcRenderer.invoke('project:scan', { zones }),
    readClaudeMd: (projectPath: string) => ipcRenderer.invoke('project:readClaudeMd', { projectPath })
  },
  templates: {
    list: () => ipcRenderer.invoke('templates:list'),
    save: (template: any) => ipcRenderer.invoke('templates:save', { template }),
    delete: (id: string) => ipcRenderer.invoke('templates:delete', { id }),
  },
  skills: {
    scan: () => ipcRenderer.invoke('skills:scan'),
    readContent: (path: string) => ipcRenderer.invoke('skills:readContent', { path })
  },
  agent: {
    writeDefinition: (cwd: string, config: {
      agentId: string; name: string; role: string; department: string;
      soul: string; skills: string[]; model: string; effort: string;
    }) => ipcRenderer.invoke('agent:writeDefinition', { cwd, config }),
    deleteDefinition: (cwd: string, agentId: string) =>
      ipcRenderer.invoke('agent:deleteDefinition', { cwd, agentId }),
    loadLogs: (agentId: string) => ipcRenderer.invoke('agent:loadLogs', { agentId }),
    clearLogs: (agentId: string) => ipcRenderer.invoke('agent:clearLogs', { agentId }),
    onStatus: (cb: (data: { agentId: string; status: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { agentId: string; status: string }) => cb(data)
      ipcRenderer.on('agent:status', handler)
      return () => ipcRenderer.removeListener('agent:status', handler)
    },
    onReport: (cb: (data: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => cb(data)
      ipcRenderer.on('agent:report', handler)
      return () => ipcRenderer.removeListener('agent:report', handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
