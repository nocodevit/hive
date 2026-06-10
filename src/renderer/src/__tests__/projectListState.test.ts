import { describe, it, expect } from 'vitest'
import { projectListState } from '../projectListState'

describe('projectListState', () => {
  it('shows loading before the initial load settles and there are no projects', () => {
    // Cold open: data.load() not resolved yet → must NOT flash "No projects yet"
    expect(projectListState(false, 0)).toBe('loading')
  })

  it('shows empty only after load settled with zero projects', () => {
    expect(projectListState(true, 0)).toBe('empty')
  })

  it('shows the list whenever projects exist, regardless of load flag', () => {
    expect(projectListState(false, 3)).toBe('list')
    expect(projectListState(true, 3)).toBe('list')
  })
})
