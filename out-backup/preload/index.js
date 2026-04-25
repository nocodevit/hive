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
    revealInFinder: (filePath) => electron.ipcRenderer.invoke("fs:revealInFinder", { filePath }),
    readFile: (filePath) => electron.ipcRenderer.invoke("fs:readFile", { filePath }),
    writeFile: (filePath, content) => electron.ipcRenderer.invoke("fs:writeFile", { filePath, content })
  },
  git: {
    worktreeAdd: (repoPath, agentId, agentName) => electron.ipcRenderer.invoke("git:worktreeAdd", { repoPath, agentId, agentName }),
    worktreeRemove: (repoPath, worktreePath) => electron.ipcRenderer.invoke("git:worktreeRemove", { repoPath, worktreePath }),
    worktreeList: (repoPath) => electron.ipcRenderer.invoke("git:worktreeList", { repoPath }),
    clone: (url, destPath, token, provider) => electron.ipcRenderer.invoke("git:clone", { url, destPath, token, provider }),
    createIntegration: (repoPath, batchNum, workerBranches) => electron.ipcRenderer.invoke("git:createIntegration", { repoPath, batchNum, workerBranches })
  },
  speech: {
    start: () => electron.ipcRenderer.invoke("speech:start"),
    stop: () => electron.ipcRenderer.invoke("speech:stop"),
    onTranscript: (cb) => {
      const handler = (_, line) => cb(line);
      electron.ipcRenderer.on("speech:transcript", handler);
      return () => electron.ipcRenderer.removeListener("speech:transcript", handler);
    }
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
    send: (agentId, type, payload) => electron.ipcRenderer.invoke("agent:send", { agentId, type, payload }),
    onStatus: (cb) => {
      const handler = (_event, data) => cb(data);
      electron.ipcRenderer.on("agent:status", handler);
      return () => electron.ipcRenderer.removeListener("agent:status", handler);
    },
    onReport: (cb) => {
      const handler = (_event, data) => cb(data);
      electron.ipcRenderer.on("agent:report", handler);
      return () => electron.ipcRenderer.removeListener("agent:report", handler);
    },
    onTaskUpdate: (cb) => {
      const handler = (_event, data) => cb(data);
      electron.ipcRenderer.on("task:update", handler);
      return () => electron.ipcRenderer.removeListener("task:update", handler);
    },
    onManagerReport: (cb) => {
      const handler = (_event, data) => cb(data);
      electron.ipcRenderer.on("manager:report", handler);
      return () => electron.ipcRenderer.removeListener("manager:report", handler);
    },
    onBatchProposal: (cb) => {
      const handler = (_event, data) => cb(data);
      electron.ipcRenderer.on("batch:proposal", handler);
      return () => electron.ipcRenderer.removeListener("batch:proposal", handler);
    },
    onDispatcherLog: (cb) => {
      const handler = (_event, data) => cb(data);
      electron.ipcRenderer.on("dispatcher:log", handler);
      return () => electron.ipcRenderer.removeListener("dispatcher:log", handler);
    }
  }
};
const { webUtils } = require("electron");
electron.contextBridge.exposeInMainWorld("api", {
  ...api,
  getFilePath: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return null;
    }
  }
});
