// IPC for Butler daily routines (settings section, wizard step) and the
// Today tab (journal).

import type { IpcMain } from 'electron'
import { isRoutineId, type RoutinesView } from '../shared/butler-routines'
import { ignoreJournalItem, isJournalDate, journalDir, listJournalDates, localDate, readJournalDay, toggleJournalItem } from './butlerJournal'
import { normalizeRoutineSettings, readRoutineSettings, writeRoutineSettings, type RoutineScheduler } from './butlerRoutines'
import type { RoutineRunner } from './butlerRoutineRun'

export interface ButlerRoutinesIpcDeps {
  ipcMain: Pick<IpcMain, 'handle'>
  folder: () => string
  scheduler: RoutineScheduler
  runner: RoutineRunner
  /** Ignoring an email task marks that email read. */
  markMailRead?: (key: string) => Promise<{ ok: boolean; error?: string }>
  now?: () => number
}

export function registerButlerRoutinesIpc(deps: ButlerRoutinesIpcDeps): void {
  const { ipcMain, scheduler, runner } = deps
  const now = deps.now ?? Date.now
  const view = (): RoutinesView & { saved: boolean } => {
    const { saved, ...settings } = readRoutineSettings(deps.folder())
    return { settings, saved, installed: scheduler.installed(), lastRuns: runner.lastRuns() }
  }
  ipcMain.handle('routines:get', () => view())
  ipcMain.handle('routines:save', async (_e, v: unknown) => {
    const s = normalizeRoutineSettings(v)
    writeRoutineSettings(deps.folder(), s)
    const errors = await scheduler.apply(s)
    return { ...view(), errors }
  })
  ipcMain.handle('routines:run', (_e, id: unknown) => (isRoutineId(id) ? runner.run(id) : { ok: false, error: 'bad_id' }))
  const dir = () => journalDir(deps.folder())
  ipcMain.handle('journal:day', (_e, date: unknown) => readJournalDay(dir(), isJournalDate(date) ? date : localDate(now())))
  ipcMain.handle('journal:dates', () => listJournalDates(dir()))
  ipcMain.handle('journal:toggle', (_e, date: unknown, index: unknown, text: unknown, done: unknown) => {
    if (!isJournalDate(date) || !Number.isInteger(index) || typeof text !== 'string') return { ok: false, error: 'bad_input' }
    return toggleJournalItem(dir(), date, index as number, text, done === true)
  })
  ipcMain.handle('journal:ignore', async (_e, date: unknown, index: unknown, text: unknown) => {
    if (!isJournalDate(date) || !Number.isInteger(index) || typeof text !== 'string') return { ok: false, error: 'bad_input' }
    const r = ignoreJournalItem(dir(), date, index as number, text)
    if (!r.ok) return r
    const isMail = (r.item.source === 'mail' || r.item.source === 'draft') && r.item.ref
    if (!isMail || !deps.markMailRead) return { ok: true }
    const m = await deps.markMailRead(r.item.ref!)
    return m.ok ? { ok: true, markedRead: true } : { ok: true, markedRead: false, error: m.error }
  })
}
