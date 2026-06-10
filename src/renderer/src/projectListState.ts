// Decides what the project sidebar shows when there are no project cards to
// render. Until the initial data.load() settles we show a "scanning" state
// rather than flashing "No projects yet" on cold open.
export type ProjectListState = 'loading' | 'empty' | 'list'

export function projectListState(loaded: boolean, count: number): ProjectListState {
  if (count > 0) return 'list'
  return loaded ? 'empty' : 'loading'
}
