import { describe, it, expect } from 'vitest'
import { parseTodoLine, categorizeTodo } from '../utils'

describe('parseTodoLine', () => {
  it('matches unchecked todo', () => {
    expect(parseTodoLine('- [ ] Fix login bug')).toEqual({ done: false, text: 'Fix login bug' })
  })

  it('matches checked todo with x', () => {
    expect(parseTodoLine('- [x] Add tests')).toEqual({ done: true, text: 'Add tests' })
  })

  it('matches checked todo with X', () => {
    expect(parseTodoLine('- [X] Deploy to prod')).toEqual({ done: true, text: 'Deploy to prod' })
  })

  it('matches with * bullet', () => {
    expect(parseTodoLine('* [ ] Refactor auth')).toEqual({ done: false, text: 'Refactor auth' })
  })

  it('matches indented todos', () => {
    expect(parseTodoLine('  - [ ] Nested task')).toEqual({ done: false, text: 'Nested task' })
  })

  it('does NOT match [New] style changelog entries', () => {
    expect(parseTodoLine('- [New] add getCategoryFlags API')).toBeNull()
  })

  it('does NOT match markdown links', () => {
    expect(parseTodoLine('- [Documentation](https://example.com)')).toBeNull()
  })

  it('does NOT match plain list items', () => {
    expect(parseTodoLine('- Just a regular list item')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseTodoLine('')).toBeNull()
  })
})

describe('categorizeTodo', () => {
  it('categorizes R&D todos', () => {
    expect(categorizeTodo('Fix login bug')).toBe('rd')
    expect(categorizeTodo('Add unit tests')).toBe('rd')
    expect(categorizeTodo('Implement dark mode')).toBe('rd')
    expect(categorizeTodo('Refactor auth module')).toBe('rd')
  })

  it('categorizes marketing todos', () => {
    expect(categorizeTodo('Create marketing plan')).toBe('marketing')
    expect(categorizeTodo('SEO optimization')).toBe('marketing')
    expect(categorizeTodo('Social media campaign')).toBe('marketing')
  })

  it('categorizes monetizing todos', () => {
    expect(categorizeTodo('Set up pricing page')).toBe('monetizing')
    expect(categorizeTodo('Add payment integration')).toBe('monetizing')
    expect(categorizeTodo('Track revenue metrics')).toBe('monetizing')
  })

  it('categorizes ops todos', () => {
    expect(categorizeTodo('Deploy to production')).toBe('ops')
    expect(categorizeTodo('Update CI pipeline')).toBe('ops')
    expect(categorizeTodo('Write documentation')).toBe('ops')
  })

  it('returns other for uncategorized', () => {
    expect(categorizeTodo('Think about naming')).toBe('other')
    expect(categorizeTodo('Call Bob')).toBe('other')
  })
})
