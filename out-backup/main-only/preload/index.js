"use strict";
const electron = require("electron");
const api = {
  pty: {
    create: (id, cwd) => electron.ipcRenderer.invoke("pty:create", { id, cwd }),
    write: (id, data) => electron.ipcRenderer.invoke("pty:write", { id, data }),
    resize: (id, cols, rows) => electron.ipcRenderer.invoke("pty:resize", { id, cols, rows }),
    kill: (id) => electron.ipcRenderer.invoke("pty:kill", { id }),
    onData: (id, cb) => {
      const handler = (_event, data) => cb(data);
      electron.ipcRenderer.on(`pty:data:${id}`, handler);
      return () => electron.ipcRenderer.removeListener(`pty:data:${id}`, handler);
    },
    onExit: (id, cb) => {
      const handler = (_event, code) => cb(code);
      electron.ipcRenderer.on(`pty:exit:${id}`, handler);
      return () => electron.ipcRenderer.removeListener(`pty:exit:${id}`, handler);
    }
  },
  dialog: {
    selectFolder: (title) => electron.ipcRenderer.invoke("dialog:selectFolder", { title })
  },
  data: {
    load: () => electron.ipcRenderer.invoke("data:load"),
    save: (data) => electron.ipcRenderer.invoke("data:save", data)
  },
  fs: {
    hasGit: (path) => electron.ipcRenderer.invoke("fs:hasGit", { path }),
    scanFiles: (dirPath, limit) => electron.ipcRenderer.invoke("fs:scanFiles", { dirPath, limit }),
    revealInFinder: (filePath) => electron.ipcRenderer.invoke("fs:revealInFinder", { filePath })
  },
  git: {
    worktreeAdd: (repoPath, agentId, agentName) => electron.ipcRenderer.invoke("git:worktreeAdd", { repoPath, agentId, agentName }),
    worktreeRemove: (repoPath, worktreePath) => electron.ipcRenderer.invoke("git:worktreeRemove", { repoPath, worktreePath }),
    worktreeList: (repoPath) => electron.ipcRenderer.invoke("git:worktreeList", { repoPath })
  },
  project: {
    scan: (zones) => electron.ipcRenderer.invoke("project:scan", { zones }),
    readClaudeMd: (projectPath) => electron.ipcRenderer.invoke("project:readClaudeMd", { projectPath })
  },
  templates: {
    list: () => electron.ipcRenderer.invoke("templates:list"),
    save: (template) => electron.ipcRenderer.invoke("templates:save", { template }),
    delete: (id) => electron.ipcRenderer.invoke("templates:delete", { id })
  },
  skills: {
    scan: () => electron.ipcRenderer.invoke("skills:scan"),
    readContent: (path) => electron.ipcRenderer.invoke("skills:readContent", { path })
  },
  agent: {
    writeDefinition: (cwd, config) => electron.ipcRenderer.invoke("agent:writeDefinition", { cwd, config }),
    deleteDefinition: (cwd, agentId) => electron.ipcRenderer.invoke("agent:deleteDefinition", { cwd, agentId }),
    loadLogs: (agentId) => electron.ipcRenderer.invoke("agent:loadLogs", { agentId }),
    clearLogs: (agentId) => electron.ipcRenderer.invoke("agent:clearLogs", { agentId }),
    onStatus: (cb) => {
      const handler = (_event, data) => cb(data);
      electron.ipcRenderer.on("agent:status", handler);
      return () => electron.ipcRenderer.removeListener("agent:status", handler);
    },
    onReport: (cb) => {
      const handler = (_event, data) => cb(data);
      electron.ipcRenderer.on("agent:report", handler);
      return () => electron.ipcRenderer.removeListener("agent:report", handler);
    }
  }
};
electron.contextBridge.exposeInMainWorld("api", api);
