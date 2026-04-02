import { describe, it, expect } from 'vitest'
import { parseTodoLine, categorizeTodo, parseTodoContracts } from '../utils'

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

describe('parseTodoContracts', () => {
  it('parses contract with all metadata', () => {
    const md = `- [ ] Add dark mode
  - depends: none
  - scope: src/renderer/styles/
  - verify:
    - npm run build
    - npm test
    - test -f test/dark-mode.test.ts
  - acceptance: theme toggle works, persists in localStorage`
    const result = parseTodoContracts(md)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      text: 'Add dark mode',
      done: false,
      depends: [],
      scope: 'src/renderer/styles/',
      verify: ['npm run build', 'npm test', 'test -f test/dark-mode.test.ts'],
      acceptance: 'theme toggle works, persists in localStorage'
    })
  })

  it('parses depends with bracket list', () => {
    const md = `- [ ] Settings page
  - depends: [dark-mode, auth-refactor]
  - scope: src/components/Settings/`
    const result = parseTodoContracts(md)
    expect(result[0].depends).toEqual(['dark-mode', 'auth-refactor'])
  })

  it('defaults missing metadata', () => {
    const md = `- [ ] Simple task`
    const result = parseTodoContracts(md)
    expect(result[0]).toMatchObject({
      text: 'Simple task',
      done: false,
      depends: [],
      scope: '.',
      verify: [],
      acceptance: ''
    })
  })

  it('parses multiple items', () => {
    const md = `- [ ] Task A
  - scope: src/a/
- [x] Task B
  - scope: src/b/
- [ ] Task C`
    const result = parseTodoContracts(md)
    expect(result).toHaveLength(3)
    expect(result[0].text).toBe('Task A')
    expect(result[0].scope).toBe('src/a/')
    expect(result[1].text).toBe('Task B')
    expect(result[1].done).toBe(true)
    expect(result[2].text).toBe('Task C')
    expect(result[2].scope).toBe('.')
  })

  it('handles depends: none and depends: []', () => {
    const md = `- [ ] Task A
  - depends: none
- [ ] Task B
  - depends: []`
    const result = parseTodoContracts(md)
    expect(result[0].depends).toEqual([])
    expect(result[1].depends).toEqual([])
  })

  it('handles single-line verify', () => {
    const md = `- [ ] Quick fix
  - verify: npm test`
    const result = parseTodoContracts(md)
    expect(result[0].verify).toEqual(['npm test'])
  })

  it('ignores headings and blank lines between items', () => {
    const md = `# Project Todo

## v0.8.0

- [ ] First task
  - scope: src/

## v0.9.0

- [ ] Second task
  - scope: lib/`
    const result = parseTodoContracts(md)
    expect(result).toHaveLength(2)
    expect(result[0].text).toBe('First task')
    expect(result[1].text).toBe('Second task')
  })

  it('returns empty for no todo items', () => {
    expect(parseTodoContracts('# Just a heading\nSome text')).toEqual([])
    expect(parseTodoContracts('')).toEqual([])
  })
})
