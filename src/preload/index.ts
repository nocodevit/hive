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
  tasks: {
    list: (projectId: string) => ipcRenderer.invoke('tasks:list', { projectId })
  },
  dispatcher: {
    loadLog: () => ipcRenderer.invoke('dispatcher:loadLog') as Promise<any[]>,
    clearLog: (keepAfter?: string) => ipcRenderer.invoke('dispatcher:clearLog', { keepAfter }) as Promise<any[]>,
  },
  inbox: {
    list: (projectId: string) => ipcRenderer.invoke('inbox:list', { projectId }) as Promise<{ agentId: string; messages: any[] }[]>,
  },
  fs: {
    hasGit: (path: string) => ipcRenderer.invoke('fs:hasGit', { path }),
    scanFiles: (dirPath: string, limit?: number) => ipcRenderer.invoke('fs:scanFiles', { dirPath, limit }),
    revealInFinder: (filePath: string) => ipcRenderer.invoke('fs:revealInFinder', { filePath }),
    openPath: (path: string) => ipcRenderer.invoke('fs:openPath', { path }) as Promise<{ ok: boolean; error?: string }>,
    readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', { filePath }) as Promise<string | null>,
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', { filePath, content }) as Promise<boolean>
  },
  git: {
    currentBranch: (cwd: string) => ipcRenderer.invoke('git:currentBranch', { cwd }) as Promise<string>,
    commitHistory: (cwd: string, days: number) => ipcRenderer.invoke('git:commitHistory', { cwd, days }) as Promise<Record<string, number>>,
    createTargetBranch: (repoPath: string, branch: string) =>
      ipcRenderer.invoke('git:createTargetBranch', { repoPath, branch }) as Promise<{ ok: boolean; existed?: boolean; error?: string }>,
    worktreeAdd: (repoPath: string, agentId: string, agentName: string) =>
      ipcRenderer.invoke('git:worktreeAdd', { repoPath, agentId, agentName }),
    worktreeRemove: (repoPath: string, worktreePath: string) =>
      ipcRenderer.invoke('git:worktreeRemove', { repoPath, worktreePath }),
    worktreeList: (repoPath: string) =>
      ipcRenderer.invoke('git:worktreeList', { repoPath }),
    clone: (url: string, destPath: string, token?: string, provider?: string) =>
      ipcRenderer.invoke('git:clone', { url, destPath, token, provider }) as Promise<{ ok: boolean; path?: string; name?: string; error?: string }>,
    createIntegration: (repoPath: string, batchNum: number, workerBranches: string[]) =>
      ipcRenderer.invoke('git:createIntegration', { repoPath, batchNum, workerBranches })
  },
  system: {
    username: () => ipcRenderer.invoke('system:username') as Promise<string>
  },
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', { key }) as Promise<any>,
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', { key, value }) as Promise<boolean>,
    addClaudeAllowRule: (rules: { toolName: string; ruleContent: string }[]) =>
      ipcRenderer.invoke('settings:addClaudeAllowRule', { rules }) as Promise<{ ok: boolean; added?: number; error?: string }>
  },
  chat: {
    start: (id: string, opts: { cwd?: string; agent?: string; name?: string; continueSession?: boolean; rebaseOnStart?: boolean }) =>
      ipcRenderer.invoke('chat:start', { id, ...opts }) as Promise<{ ok: boolean }>,
    send: (id: string, text: string) =>
      ipcRenderer.invoke('chat:send', { id, text }) as Promise<{ ok: boolean; error?: string }>,
    respondPermission: (id: string, requestId: string, decision: 'allow' | 'deny', input?: Record<string, unknown>, denyMessage?: string) =>
      ipcRenderer.invoke('chat:respondPermission', { id, requestId, decision, input, denyMessage }) as Promise<{ ok: boolean; error?: string }>,
    stop: (id: string) => ipcRenderer.invoke('chat:stop', { id }) as Promise<{ ok: boolean }>,
    loadOlder: (id: string, batch?: number) =>
      ipcRenderer.invoke('chat:loadOlder', { id, batch }) as Promise<{ loaded: number; hasOlder: boolean; error?: string }>,
    startRemoteControl: (id: string) =>
      ipcRenderer.invoke('chat:startRemoteControl', { id }) as Promise<{ ok: boolean; sid?: string; error?: string }>,
    resumeFromRemoteControl: (id: string) =>
      ipcRenderer.invoke('chat:resumeFromRemoteControl', { id }) as Promise<{ ok: boolean; sid?: string; error?: string }>,
    interrupt: (id: string) =>
      ipcRenderer.invoke('chat:interrupt', { id }) as Promise<{ ok: boolean; error?: string }>,
    compact: (id: string) =>
      ipcRenderer.invoke('chat:compact', { id }) as Promise<{ ok: boolean; error?: string }>,
    resumeSmart: (id: string) =>
      ipcRenderer.invoke('chat:resumeSmart', { id }) as Promise<{ ok: boolean; sid?: string; compacted?: boolean; error?: string }>,
    startWithSummary: (id: string) =>
      ipcRenderer.invoke('chat:startWithSummary', { id }) as Promise<{ ok: boolean; error?: string }>,
    cancelAutoContinue: (id: string) =>
      ipcRenderer.invoke('chat:cancelAutoContinue', { id }) as Promise<{ ok: boolean }>,
    onAutoContinue: (id: string, cb: (payload: { at: number } | null) => void) => {
      const handler = (_e: any, data: any) => cb(data)
      ipcRenderer.on(`chat:autoContinue:${id}`, handler)
      return () => ipcRenderer.removeListener(`chat:autoContinue:${id}`, handler)
    },
    onRcOutput: (id: string, cb: (data: string) => void) => {
      const handler = (_e: any, data: string) => cb(data)
      ipcRenderer.on(`chat:rc_output:${id}`, handler)
      return () => ipcRenderer.removeListener(`chat:rc_output:${id}`, handler)
    },
    onRcExit: (id: string, cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on(`chat:rc_exit:${id}`, handler)
      return () => ipcRenderer.removeListener(`chat:rc_exit:${id}`, handler)
    },
    onEvent: (id: string, cb: (ev: any) => void) => {
      const handler = (_e: any, data: any) => cb(data)
      ipcRenderer.on(`chat:event:${id}`, handler)
      return () => ipcRenderer.removeListener(`chat:event:${id}`, handler)
    },
    onPrepend: (id: string, cb: (payload: { events: any[]; hasOlder: boolean }) => void) => {
      const handler = (_e: any, data: any) => cb(data)
      ipcRenderer.on(`chat:prepend:${id}`, handler)
      return () => ipcRenderer.removeListener(`chat:prepend:${id}`, handler)
    },
    onStderr: (id: string, cb: (line: string) => void) => {
      const handler = (_e: any, data: string) => cb(data)
      ipcRenderer.on(`chat:stderr:${id}`, handler)
      return () => ipcRenderer.removeListener(`chat:stderr:${id}`, handler)
    },
    onExit: (id: string, cb: (code: number) => void) => {
      const handler = (_e: any, code: number) => cb(code)
      ipcRenderer.on(`chat:exit:${id}`, handler)
      return () => ipcRenderer.removeListener(`chat:exit:${id}`, handler)
    },
    onUsage: (id: string, cb: (usage: any) => void) => {
      const handler = (_e: any, data: any) => cb(data)
      ipcRenderer.on(`chat:usage:${id}`, handler)
      return () => ipcRenderer.removeListener(`chat:usage:${id}`, handler)
    }
  },
  storage: {
    claudeLogStats: (retentionDays: number) =>
      ipcRenderer.invoke('storage:claudeLogStats', { retentionDays }) as Promise<{
        totalFiles: number; totalBytes: number
        mainFiles: number; mainBytes: number
        subagentFiles: number; subagentBytes: number
        staleFiles: number; staleBytes: number
        staleMainFiles: number; staleMainBytes: number
        staleSubagentFiles: number; staleSubagentBytes: number
        topStale: { path: string; bytes: number; mtimeMs: number }[]
      }>,
    cleanClaudeLogs: (retentionDays: number, dryRun: boolean) =>
      ipcRenderer.invoke('storage:cleanClaudeLogs', { retentionDays, dryRun }) as Promise<{
        deletedFiles: number; deletedBytes: number; removedDirs: number; errors: string[]
      }>
  },
  speech: {
    start: () => ipcRenderer.invoke('speech:start') as Promise<{ ok: boolean; error?: string }>,
    stop: () => ipcRenderer.invoke('speech:stop') as Promise<{ ok: boolean }>,
    onTranscript: (cb: (line: string) => void) => {
      const handler = (_: any, line: string) => cb(line)
      ipcRenderer.on('speech:transcript', handler)
      return () => ipcRenderer.removeListener('speech:transcript', handler)
    }
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
    send: (agentId: string, type: string, payload: object) =>
      ipcRenderer.invoke('agent:send', { agentId, type, payload }),
    onStatus: (cb: (data: { agentId: string; status: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { agentId: string; status: string }) => cb(data)
      ipcRenderer.on('agent:status', handler)
      return () => ipcRenderer.removeListener('agent:status', handler)
    },
    onReport: (cb: (data: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => cb(data)
      ipcRenderer.on('agent:report', handler)
      return () => ipcRenderer.removeListener('agent:report', handler)
    },
    onTaskUpdate: (cb: (data: { projectId: string; tasks: any[] }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => cb(data)
      ipcRenderer.on('task:update', handler)
      return () => ipcRenderer.removeListener('task:update', handler)
    },
    onManagerReport: (cb: (data: { title: string; message: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => cb(data)
      ipcRenderer.on('manager:report', handler)
      return () => ipcRenderer.removeListener('manager:report', handler)
    },
    onBatchProposal: (cb: (data: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => cb(data)
      ipcRenderer.on('batch:proposal', handler)
      return () => ipcRenderer.removeListener('batch:proposal', handler)
    },
    onDispatcherLog: (cb: (data: { time: string; action: string; detail: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => cb(data)
      ipcRenderer.on('dispatcher:log', handler)
      return () => ipcRenderer.removeListener('dispatcher:log', handler)
    }
  }
}

// Expose getDropPaths: renderer calls this from drop event with file list
// Preload runs in same process but isolated world — we can use webUtils to get path
const { webUtils } = require('electron')

contextBridge.exposeInMainWorld('api', {
  ...api,
  getFilePath: (file: File) => {
    try { return webUtils.getPathForFile(file) } catch { return null }
  }
})
