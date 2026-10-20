// `Hive --butler-routine=<id>` (started by a launchd job): when Hive is
// already running, hand the routine to it through Electron's
// single-instance lock ('second-instance') and exit; otherwise run it
// headless (no window, no dock icon) and quit.
//
// A normal launch takes the lock too, so a routine can find it. A normal
// launch that does not get the lock keeps running as before (Hive never
// refused a second window before, and dev builds share the lock).

import { isRoutineId, type RoutineId } from '../shared/butler-routines'
import { parseRoutineArg } from './butlerRoutines'

export interface AppLike {
  requestSingleInstanceLock(additionalData?: Record<string, unknown>): boolean
  on(event: 'second-instance', cb: (e: unknown, argv: string[], cwd: string, additionalData: unknown) => void): unknown
  whenReady(): Promise<unknown>
  quit(): void
  dock?: { hide(): void }
}

export type RunRoutine = (id: RoutineId, opts: { scheduled: boolean }) => Promise<unknown>

export type RoutineMode = { headless: false } | { headless: true; routine: RoutineId; forwarded: boolean }

/** The routine another Hive launch asked for (argv first, then the lock's additionalData). */
export function forwardedRoutine(argv: readonly string[], additionalData: unknown): RoutineId | null {
  const fromArgv = parseRoutineArg(argv)
  if (fromArgv) return fromArgv
  const v = (additionalData as { butlerRoutine?: unknown } | null)?.butlerRoutine
  return isRoutineId(v) ? v : null
}

export function startRoutineMode(app: AppLike, argv: readonly string[], run: RunRoutine, log: (msg: string) => void = () => {}): RoutineMode {
  const routine = parseRoutineArg(argv)
  if (!routine) {
    app.requestSingleInstanceLock()
    app.on('second-instance', (_e, otherArgv, _cwd, data) => {
      const id = forwardedRoutine(otherArgv, data)
      if (!id) return
      log(`routine ${id}: forwarded`)
      void app.whenReady().then(() => run(id, { scheduled: true })).catch(e => log(`routine ${id}: ${e}`))
    })
    return { headless: false }
  }
  if (!app.requestSingleInstanceLock({ butlerRoutine: routine })) {
    // Hive is running: it got our argv through 'second-instance'.
    app.quit()
    return { headless: true, routine, forwarded: true }
  }
  app.dock?.hide()
  // Routines forwarded to this headless run while it works are run too;
  // quit once the last one is done.
  let pending = 0
  const go = (id: RoutineId) => {
    pending++
    void app.whenReady()
      .then(() => run(id, { scheduled: true }))
      .catch(e => log(`routine ${id}: ${e}`))
      .finally(() => { if (--pending === 0) app.quit() })
  }
  app.on('second-instance', (_e, otherArgv, _cwd, data) => {
    const id = forwardedRoutine(otherArgv, data)
    if (id && pending > 0) go(id)
  })
  go(routine)
  return { headless: true, routine, forwarded: false }
}
