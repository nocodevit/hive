declare global {
  interface Window {
    api: {
      pty: {
        create: (id: string, cwd?: string) => Promise<{ pid: number }>
        write: (id: string, data: string) => Promise<void>
        resize: (id: string, cols: number, rows: number) => Promise<void>
        kill: (id: string) => Promise<void>
        onData: (id: string, cb: (data: string) => void) => () => void
        onExit: (id: string, cb: (code: number) => void) => () => void
      }
      dialog: {
        selectFolder: (title?: string) => Promise<string | null>
      }
      data: {
        load: () => Promise<Record<string, unknown>>
        save: (data: Record<string, unknown>) => Promise<boolean>
      }
      tasks: {
        list: (projectId: string) => Promise<any[]>
      }
      dispatcher: {
        loadLog: () => Promise<any[]>
        clearLog: (keepAfter?: string) => Promise<any[]>
      }
      inbox: {
        list: (projectId: string) => Promise<{ agentId: string; messages: any[] }[]>
      }
      fs: {
        hasGit: (path: string) => Promise<boolean>
        scanFiles: (dirPath: string, limit?: number) => Promise<{ path: string; mtime: number; size: number }[]>
        revealInFinder: (filePath: string) => Promise<void>
        readFile: (filePath: string) => Promise<string | null>
        writeFile: (filePath: string, content: string) => Promise<boolean>
      }
      git: {
        currentBranch: (cwd: string) => Promise<string>
        commitHistory: (cwd: string, days: number) => Promise<Record<string, number>>
        createTargetBranch: (repoPath: string, branch: string) => Promise<{ ok: boolean; existed?: boolean; error?: string }>
        worktreeAdd: (repoPath: string, agentId: string, agentName: string) =>
          Promise<{ ok: boolean; path?: string; branch?: string; error?: string }>
        worktreeRemove: (repoPath: string, worktreePath: string) =>
          Promise<{ ok: boolean; error?: string }>
        worktreeList: (repoPath: string) =>
          Promise<{ path: string; branch: string }[]>
        clone: (url: string, destPath: string, token?: string, provider?: string) =>
          Promise<{ ok: boolean; path?: string; name?: string; error?: string }>
        createIntegration: (repoPath: string, batchNum: number, workerBranches: string[]) =>
          Promise<{ ok: boolean; branch?: string; results?: any[]; error?: string }>
      }
      speech: {
        start: () => Promise<{ ok: boolean; error?: string }>
        stop: () => Promise<{ ok: boolean }>
        onTranscript: (cb: (line: string) => void) => () => void
      }
      system: {
        username: () => Promise<string>
      }
      settings: {
        get: (key: string) => Promise<any>
        set: (key: string, value: unknown) => Promise<boolean>
      }
      chat: {
        start: (id: string, opts: { cwd?: string; agent?: string; name?: string; continueSession?: boolean; rebaseOnStart?: boolean }) => Promise<{ ok: boolean }>
        send: (id: string, text: string) => Promise<{ ok: boolean; error?: string }>
        stop: (id: string) => Promise<{ ok: boolean }>
        onEvent: (id: string, cb: (ev: any) => void) => () => void
        onStderr: (id: string, cb: (line: string) => void) => () => void
        onExit: (id: string, cb: (code: number) => void) => () => void
        onUsage: (id: string, cb: (usage: {
          costUSD?: number
          burnPerHour?: number
          projectedUSD?: number
          remainingMinutes?: number
          totalTokens?: number
        }) => void) => () => void
      }
      getFilePath: (file: File) => string | null
      project: {
        scan: (zones: { path: string; type: string }[]) => Promise<{ projectStage: string; todos: any[] }>
      }
      skills: {
        scan: () => Promise<{ name: string; pack: string; path: string; description: string }[]>
        readContent: (path: string) => Promise<string | null>
      }
      agent: {
        writeDefinition: (cwd: string, config: {
          agentId: string; name: string; role: string; department: string;
          soul: string; skills: string[]; model: string; effort: string;
          taskGroupRole?: string; todoSource?: string; maxGateRetries?: number;
        }) => Promise<{ ok: boolean; agentName?: string; error?: string }>
        deleteDefinition: (cwd: string, agentId: string) => Promise<boolean>
        loadLogs: (agentId: string) => Promise<any[]>
        clearLogs: (agentId: string) => Promise<boolean>
        send: (agentId: string, type: string, payload: object) => Promise<boolean>
        onStatus: (cb: (data: { agentId: string; status: string }) => void) => () => void
        onReport: (cb: (data: any) => void) => () => void
        onTaskUpdate: (cb: (data: { projectId: string; tasks: any[] }) => void) => () => void
        onManagerReport: (cb: (data: { title: string; message: string }) => void) => () => void
        onBatchProposal: (cb: (data: any) => void) => () => void
        onDispatcherLog: (cb: (data: { time: string; action: string; detail: string }) => void) => () => void
      }
    }
  }
}

export {}
