declare global {
  interface Window {
    api: {
      pty: {
        create: (id: string, cwd?: string) => Promise<{ pid: number }>
        write: (id: string, data: string) => Promise<void>
        resize: (id: string, cols: number, rows: number) => Promise<void>
        kill: (id: string) => Promise<void>
        hasAgentSession: (id: string) => Promise<{ alive: boolean; error?: string }>
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
        openPath: (path: string) => Promise<{ ok: boolean; error?: string }>
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
      claude: {
        status: () => Promise<{ installed: boolean; installCommand: string }>
        install: () => Promise<{ ok: boolean }>
        onInstallOutput: (cb: (data: { kind: 'stdout' | 'stderr'; text: string }) => void) => () => void
      }
      storage: {
        claudeLogStats: (retentionDays: number) => Promise<{
          totalFiles: number; totalBytes: number
          mainFiles: number; mainBytes: number
          subagentFiles: number; subagentBytes: number
          staleFiles: number; staleBytes: number
          staleMainFiles: number; staleMainBytes: number
          staleSubagentFiles: number; staleSubagentBytes: number
          topStale: { path: string; bytes: number; mtimeMs: number }[]
        }>
        cleanClaudeLogs: (retentionDays: number, dryRun: boolean) => Promise<{
          deletedFiles: number; deletedBytes: number; removedDirs: number; errors: string[]
        }>
      }
      system: {
        username: () => Promise<string>
      }
      auth: {
        login: () => Promise<{ ok: boolean; code: number; error?: string }>
        cancel: () => Promise<{ ok: boolean }>
        onOutput: (cb: (payload: { kind: 'stdout' | 'stderr'; text: string }) => void) => () => void
      }
      crash: {
        report: (kind: string, info: Record<string, unknown>) => Promise<{ ok: boolean }>
      }
      settings: {
        get: (key: string) => Promise<any>
        set: (key: string, value: unknown) => Promise<boolean>
        addClaudeAllowRule: (rules: { toolName: string; ruleContent: string }[]) => Promise<{ ok: boolean; added?: number; error?: string }>
      }
      chat: {
        start: (id: string, opts: { cwd?: string; agent?: string; name?: string; continueSession?: boolean; rebaseOnStart?: boolean }) => Promise<{ ok: boolean }>
        send: (id: string, text: string) => Promise<{ ok: boolean; error?: string }>
        respondPermission: (id: string, requestId: string, decision: 'allow' | 'deny', input?: Record<string, unknown>, denyMessage?: string) => Promise<{ ok: boolean; error?: string }>
        stop: (id: string) => Promise<{ ok: boolean }>
        loadOlder: (id: string, batch?: number) => Promise<{ loaded: number; hasOlder: boolean; error?: string }>
        startRemoteControl: (id: string) => Promise<{ ok: boolean; sid?: string; error?: string }>
        resumeFromRemoteControl: (id: string) => Promise<{ ok: boolean; sid?: string; error?: string }>
        interrupt: (id: string) => Promise<{ ok: boolean; error?: string }>
        compact: (id: string) => Promise<{ ok: boolean; error?: string }>
        resumeSmart: (id: string) => Promise<{ ok: boolean; sid?: string; compacted?: boolean; error?: string }>
        startWithSummary: (id: string) => Promise<{ ok: boolean; error?: string }>
        cancelAutoContinue: (id: string) => Promise<{ ok: boolean }>
        onAutoContinue: (id: string, cb: (payload: { at: number } | null) => void) => () => void
        onRcOutput: (id: string, cb: (data: string) => void) => () => void
        onRcExit: (id: string, cb: () => void) => () => void
        onEvent: (id: string, cb: (ev: any) => void) => () => void
        onPrepend: (id: string, cb: (payload: { events: any[]; hasOlder: boolean }) => void) => () => void
        onStderr: (id: string, cb: (line: string) => void) => () => void
        onExit: (id: string, cb: (code: number) => void) => () => void
        onUsage: (id: string, cb: (usage: {
          costUSD?: number
          burnPerHour?: number
          projectedUSD?: number
          remainingMinutes?: number
          totalTokens?: number
        }) => void) => () => void
        onCompactStuck: (id: string, cb: (payload: { elapsedMs: number; lastOutputAgeMs: number }) => void) => () => void
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
