import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, watch } from 'fs'
import type { BrowserWindow } from 'electron'

export interface TaskData {
  id: string
  title: string
  status: 'pending' | 'assigned' | 'in_progress' | 'done' | 'blocked'
  owner: string | null
  batch: number
  depends: string[]
  scope: string
  acceptance: string
  verify: string[]
  attempt: number
  blocked_reason: string | null
}

const COMMS_BASE = '.hive/comms'

function tasksDir(homeDir: string, projectId: string): string {
  return join(homeDir, COMMS_BASE, projectId, 'tasks')
}

function reportsDir(homeDir: string, projectId: string): string {
  return join(homeDir, COMMS_BASE, projectId, 'reports')
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function taskFilePath(homeDir: string, projectId: string, taskId: string): string {
  return join(tasksDir(homeDir, projectId), `${taskId}.json`)
}

function getNextId(homeDir: string, projectId: string): string {
  const dir = tasksDir(homeDir, projectId)
  ensureDir(dir)
  const files = readdirSync(dir).filter(f => f.match(/^task-\d+\.json$/))
  if (files.length === 0) return 'task-001'
  const nums = files.map(f => parseInt(f.match(/task-(\d+)/)?.[1] || '0', 10))
  const next = Math.max(...nums) + 1
  return `task-${String(next).padStart(3, '0')}`
}

export function createTask(homeDir: string, projectId: string, data: Omit<TaskData, 'id'>): TaskData {
  const id = getNextId(homeDir, projectId)
  const task: TaskData = { id, ...data }
  const dir = tasksDir(homeDir, projectId)
  ensureDir(dir)
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(task, null, 2))
  return task
}

export function readTask(homeDir: string, projectId: string, taskId: string): TaskData | null {
  const fp = taskFilePath(homeDir, projectId, taskId)
  if (!existsSync(fp)) return null
  return JSON.parse(readFileSync(fp, 'utf-8'))
}

export function updateTask(homeDir: string, projectId: string, taskId: string, updates: Partial<TaskData>): TaskData | null {
  const task = readTask(homeDir, projectId, taskId)
  if (!task) return null
  const updated = { ...task, ...updates, id: task.id } // never overwrite id
  writeFileSync(taskFilePath(homeDir, projectId, taskId), JSON.stringify(updated, null, 2))
  return updated
}

export function listTasks(homeDir: string, projectId: string): TaskData[] {
  const dir = tasksDir(homeDir, projectId)
  ensureDir(dir)
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort()
  return files.map(f => {
    try { return JSON.parse(readFileSync(join(dir, f), 'utf-8')) } catch { return null }
  }).filter(Boolean) as TaskData[]
}

export function deleteTask(homeDir: string, projectId: string, taskId: string): boolean {
  const fp = taskFilePath(homeDir, projectId, taskId)
  if (!existsSync(fp)) return false
  unlinkSync(fp)
  return true
}

export function ensureReportsDir(homeDir: string, projectId: string): string {
  const dir = reportsDir(homeDir, projectId)
  ensureDir(dir)
  return dir
}

export function watchTasks(homeDir: string, projectId: string, win: BrowserWindow | null): () => void {
  const dir = tasksDir(homeDir, projectId)
  ensureDir(dir)
  const watcher = watch(dir, () => {
    const tasks = listTasks(homeDir, projectId)
    if (win && !win.isDestroyed()) {
      win.webContents.send('task:update', { projectId, tasks })
    }
  })
  return () => watcher.close()
}
