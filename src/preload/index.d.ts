type FeishuStatus =
  | { state: 'signed_out' }
  | { state: 'signing_in' }
  | { state: 'signed_in'; name: string; openId: string; scope: string; refreshExpiresAt: number }
  | { state: 'expired' }
  | { state: 'error'; error: string }

type ButlerAgentRow = {
  agentId: string; agent: string; projectId: string; project: string
  role: string; note: string; chatLive: boolean; activity: 'working' | 'waiting' | 'off'; updatedAt: number
}

type JiraConnectionView = { mode: 'auto' | 'mcp' | 'rest'; url: string; email: string; hasToken: boolean; mcp: boolean; using: 'mcp' | 'rest' | null }

type ApprovalItem = {
  id: string; kind: string; title: string; subtitle: string; draft: string
  payload: Record<string, unknown>; action: string; status: string; createdAt: number; resolvedAt?: number; error?: string
}

type TelegramStep = { ok: true; status: import('../shared/notify').TelegramStatus } | { ok: false; error: string }

type ButlerSetup = { marks: Record<string, 'done' | 'skipped'>; cardHidden: boolean }

type ButlerState = {
  enabled: boolean
  status: 'off' | 'starting' | 'needs_trust' | 'connected' | 'error'
  url?: string
  error?: string
}

// [butler:wake]
type WakeState = { enabled: boolean; status: 'off' | 'starting' | 'listening' | 'error'; error?: string }
type WakePlan =
  | { kind: 'agent'; row: ButlerAgentRow; text: string }
  | { kind: 'no_session'; row: ButlerAgentRow; text: string }
  | { kind: 'ambiguous'; name: string; project?: string; candidates: ButlerAgentRow[]; text: string }
  | { kind: 'not_found'; name: string; project?: string; candidates: ButlerAgentRow[]; text: string }
  | { kind: 'butler'; live: boolean; text: string }
  | { kind: 'empty' }
type WakeEvent =
  | { type: 'state'; state: WakeState }
  | { type: 'wake' } | { type: 'cancel' } | { type: 'timeout' }
  | { type: 'proposal'; proposal: { id: string; heard: string; plan: WakePlan } }
type WakeSendResult = { ok: true; to: string } | { ok: false; error: string }

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
        selectFiles: () => Promise<string[]>
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
      butler: {
        state: () => Promise<ButlerState>
        setEnabled: (enabled: boolean) => Promise<ButlerState>
        confirmTrust: () => Promise<{ ok: boolean }>
        retry: () => Promise<ButlerState>
        shouldOffer: () => Promise<boolean>
        folder: () => Promise<string>
        setup: () => Promise<ButlerSetup>
        markSetup: (step: string, mark: 'done' | 'skipped' | null) => Promise<ButlerSetup>
        hideSetupCard: (hidden: boolean) => Promise<ButlerSetup>
        profile: () => Promise<Record<string, string>>
        saveProfile: (p: Record<string, string>) => Promise<Record<string, string>>
        pinned: () => Promise<boolean>
        setPinned: (v: boolean) => Promise<boolean>
        agents: () => Promise<ButlerAgentRow[]>
        offerAnswered: () => Promise<{ ok: boolean }>
        onState: (cb: (s: ButlerState) => void) => () => void
        onStartAgent: (cb: (payload: { agentId: string; mode: 'resume' | 'new' }) => void) => () => void
      }
      todos: {
        list: () => Promise<import('../renderer/src/lib/butler-todos').TodoView[]>
        setDue: (ids: string[], due: string) => Promise<number>
        add: (input: { title: string; due?: string }) => Promise<import('../renderer/src/lib/butler-todos').TodoView | null>
        setStatus: (id: string, status: 'open' | 'done' | 'dropped') => Promise<boolean>
        note: (id: string, text: string) => Promise<boolean>
        fromApproval: (id: string, note?: string) => Promise<import('../renderer/src/lib/butler-todos').TodoView | null>
        onChange: (cb: () => void) => () => void
      }
      approvals: {
        list: () => Promise<ApprovalItem[]>
        history: () => Promise<ApprovalItem[]>
        approve: (id: string, draft?: string) => Promise<{ ok: boolean; error?: string }>
        reject: (id: string) => Promise<boolean>
        onChange: (cb: (pending: ApprovalItem[]) => void) => () => void
      }
      // [butler:skills]
      butlerSkills: {
        profilePreview: (p: Record<string, string>) => Promise<string>
        list: () => Promise<import('../renderer/src/lib/butler-skills').SkillInfo[] | import('../renderer/src/lib/butler-skills').IpcError>
        get: (id: string) => Promise<import('../renderer/src/lib/butler-skills').SkillDetail | import('../renderer/src/lib/butler-skills').IpcError>
        saveOverlay: (id: string, overlay: import('../renderer/src/lib/butler-skills').SkillOverlay) => Promise<import('../renderer/src/lib/butler-skills').SkillDetail | import('../renderer/src/lib/butler-skills').IpcError>
        saveOverride: (id: string, md: string) => Promise<{ ok: boolean; problems?: import('../renderer/src/lib/butler-skills').LintProblem[]; error?: string }>
        reset: (id: string) => Promise<import('../renderer/src/lib/butler-skills').SkillDetail | import('../renderer/src/lib/butler-skills').IpcError>
        ackDefault: (id: string) => Promise<import('../renderer/src/lib/butler-skills').SkillDetail | import('../renderer/src/lib/butler-skills').IpcError>
        useDefault: (id: string) => Promise<import('../renderer/src/lib/butler-skills').SkillDetail | import('../renderer/src/lib/butler-skills').IpcError>
        saveNew: (id: string) => Promise<(import('../renderer/src/lib/butler-skills').SkillDetail & { savedCopy: string }) | import('../renderer/src/lib/butler-skills').IpcError>
        merge: (id: string) => Promise<import('../renderer/src/lib/butler-skills').EditProposal>
        compare: (id: string) => Promise<{ defaultMd: string; mine: string; diff: import('../renderer/src/lib/butler-skills').DiffLine[] } | import('../renderer/src/lib/butler-skills').IpcError>
        tryIt: (id: string, sample: string, md?: string) => Promise<{ ok: boolean; output?: string; error?: string }>
        propose: (id: string, request: string) => Promise<import('../renderer/src/lib/butler-skills').EditProposal>
        reveal: (id: string) => Promise<{ ok: boolean; error?: string }>
      }

      jira: {
        get: () => Promise<{ settings: any | null; connected: boolean; connection: JiraConnectionView }>
        save: (settings: unknown) => Promise<{ ok: true; settings: any } | { ok: false; error: string }>
        discover: () => Promise<{ ok: boolean; draft?: any; error?: string }>
        saveConnection: (conn: { mode: string; url: string; email: string }, token?: string | null) => Promise<JiraConnectionView>
        testConnection: (conn: { mode: string; url: string; email: string }, token?: string) => Promise<{ ok: boolean; name?: string; error?: string }>
      }
      // [butler:mail-routines]
      mail: {
        list: () => Promise<import('../shared/butler-mail').MailAccountView[]>
        test: (input: import('../shared/butler-mail').MailAccountInput) => Promise<import('../shared/butler-mail').MailTestResult>
        save: (input: import('../shared/butler-mail').MailAccountInput) => Promise<{ ok: true; account: import('../shared/butler-mail').MailAccountView } | { ok: false; error: string }>
        remove: (id: string) => Promise<boolean>
        sortNow: () => Promise<Array<{ accountId: string; fetched: number; sorted: number; drafted: number; error?: string }>>
        answer: (id: string, text: string) => Promise<{ ok: true; replyId: string } | { ok: false; error: string; question?: string }>
        openHelp: (presetId: string) => Promise<boolean>
      }
      routines: {
        get: () => Promise<import('../shared/butler-routines').RoutinesView & { saved: boolean }>
        save: (settings: import('../shared/butler-routines').RoutineSettings) => Promise<import('../shared/butler-routines').RoutinesView & { saved: boolean; errors: Record<string, string> }>
        run: (id: string) => Promise<import('../shared/butler-routines').RoutineRunRecord>
      }
      journal: {
        day: (date?: string) => Promise<import('../shared/butler-routines').JournalDay>
        dates: () => Promise<string[]>
        toggle: (date: string, index: number, text: string, done: boolean) => Promise<{ ok: boolean; error?: string }>
        ignore: (date: string, index: number, text: string) => Promise<{ ok: boolean; markedRead?: boolean; error?: string }>
      }

      // [butler:feishu-agent-calendar]
      feishuAgent: {
        get: () => Promise<import('./feishuAgentTypes').FeishuAgentView>
        set: (patch: Partial<import('./feishuAgentTypes').FeishuAgentSettings>) => Promise<import('./feishuAgentTypes').FeishuAgentView>
        log: () => Promise<import('./feishuAgentTypes').FeishuLogEntry[]>
        scanNow: () => Promise<{ ok: boolean; handled: number; error?: string }>
        setPerson: (id: string, relation: string) => Promise<import('./feishuAgentTypes').FeishuAgentView>
        recall: (id: string) => Promise<{ ok: boolean; error?: string }>
        onChange: (cb: () => void) => () => void
      }
      calendar: {
        get: () => Promise<import('./feishuAgentTypes').CalendarSettings>
        set: (patch: Partial<import('./feishuAgentTypes').CalendarSettings>) => Promise<import('./feishuAgentTypes').CalendarSettings>
        allowMac: () => Promise<{ ok: boolean; granted: boolean; error?: string }>
        agenda: (date?: string) => Promise<import('./feishuAgentTypes').DayAgenda>
      }

      // [butler:wake]
      wake: {
        state: () => Promise<WakeState>
        setEnabled: (enabled: boolean) => Promise<WakeState>
        send: (id: string, agentId?: string) => Promise<WakeSendResult>
        dismiss: (id: string) => Promise<{ ok: boolean }>
        onEvent: (cb: (ev: WakeEvent) => void) => () => void
      }

      notify: {
        get: () => Promise<import('../shared/notify').NotifyView>
        save: (settings: import('../shared/notify').NotifySettings) => Promise<import('../shared/notify').NotifyView>
        test: () => Promise<{ ok: boolean; shown: boolean }>
        openSystemSettings: () => Promise<{ ok: boolean }>
        setPlace: (place: string) => void
        onOpen: (cb: (target: import('../shared/notify').NotifyTarget) => void) => () => void
      }
      telegram: {
        openBotFather: () => Promise<{ ok: boolean }>
        setToken: (token: string) => Promise<TelegramStep>
        findChat: () => Promise<TelegramStep>
        test: () => Promise<{ ok: boolean; error?: string }>
        disconnect: () => Promise<TelegramStep>
      }

      feishu: {
        status: () => Promise<FeishuStatus>
        login: () => Promise<FeishuStatus>
        logout: () => Promise<FeishuStatus>
        onStatus: (cb: (s: FeishuStatus) => void) => () => void
      }
      speech: {
        start: () => Promise<{ ok: boolean; error?: string }>
        stop: () => Promise<{ ok: boolean }>
        onTranscript: (cb: (line: string) => void) => () => void
      }
      claude: {
        auth: () => Promise<{ ok: boolean; loggedIn: boolean; authMethod: string; error?: string }>
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
        submitCode: (code: string) => Promise<{ ok: boolean; error?: string }>
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
        liveAgents: () => Promise<string[]>
        send: (id: string, text: string) => Promise<{ ok: boolean; error?: string }>
        sendAsUser: (id: string, text: string) => Promise<{ ok: boolean; error?: string }>
        discussWith: (agentId: string, text: string) => Promise<{ ok: boolean; error?: string }>
        respondPermission: (id: string, requestId: string, decision: 'allow' | 'deny', input?: Record<string, unknown>, denyMessage?: string) => Promise<{ ok: boolean; error?: string }>
        allowToolForSession: (id: string, toolName: string) => Promise<{ ok: boolean; error?: string }>
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
        listUnclosed: () => Promise<Array<{
          agentId: string; agent: string; project: string; lastTask: string; lastActiveMs: number
          contextSize: string; peakInputTokens: number; hasSession: boolean
        }>>
        resolveUnclosed: () => Promise<{ ok: boolean }>
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
