import { describe, it, expect } from 'vitest'
import { groupTodos, isOverdue, sortTodos, todoDiscussText, type TodoView } from '../butler-todos'

const NOW = new Date(2026, 9, 23, 10, 0)
const at = (d: number, h = 9) => new Date(2026, 9, d, h).getTime()
const t = (id: string, o: Partial<TodoView> = {}): TodoView => ({ id, title: id, createdAt: at(23), createdBy: 'owner', source: 'chat', refs: {}, status: 'open', events: [], ...o })

describe('butler-todos', () => {
  const list = [t('a', { createdAt: at(23, 8) }), t('b', { createdAt: at(22), source: 'feishu', due: '2026-10-22' }), t('c', { createdAt: at(20), source: 'jira', due: '2026-10-25' }), t('d', { createdAt: at(1), due: '2026-10-23' })]
  it('groups by created time, source or due date, in a fixed order', () => {
    expect(groupTodos(list, 'created', 'newest', NOW).map(g => [g.label, g.items.map(x => x.id)])).toEqual([['Today', ['a']], ['Yesterday', ['b']], ['This week', ['c']], ['Earlier', ['d']]])
    expect(groupTodos(list, 'source', 'newest', NOW).map(g => g.label)).toEqual(['Chat', 'Feishu', 'Jira'])
    expect(groupTodos(list, 'due', 'newest', NOW).map(g => [g.label, g.items.map(x => x.id)])).toEqual([['Overdue', ['b']], ['Due today', ['d']], ['This week', ['c']], ['No due date', ['a']]])
  })
  it('⚡ 要命 is always on top and 🧊 冻着 at the bottom; group by priority', () => {
    const l = [t('x', { createdAt: at(23, 9) }), t('frozen', { createdAt: at(23, 10), priority: 3 }), t('fire', { createdAt: at(20), priority: 1 })]
    expect(sortTodos(l, 'newest').map(x => x.id)).toEqual(['fire', 'x', 'frozen'])
    expect(sortTodos(l, 'oldest').map(x => x.id)).toEqual(['fire', 'x', 'frozen'])
    expect(groupTodos(l, 'priority', 'newest', NOW).map(g => [g.label, g.items.map(x => x.id)])).toEqual([['⚡ 要命', ['fire']], ['🔥 冒烟', ['x']], ['🧊 冻着', ['frozen']]])
    expect(todoDiscussText(l[2])).toContain('- [要命] fire')
  })
  it('sorts newest / oldest / by due', () => {
    expect(sortTodos(list, 'oldest').map(x => x.id)).toEqual(['d', 'c', 'b', 'a'])
    expect(sortTodos(list, 'due').map(x => x.id)).toEqual(['b', 'd', 'c', 'a'])
  })
  it('overdue only while open; the chat text carries the whole story', () => {
    expect(isOverdue(list[1], NOW)).toBe(true)
    expect(isOverdue({ ...list[1], status: 'done' }, NOW)).toBe(false)
    const text = todoDiscussText(t('x', { title: 'SOW 进 P4?', events: [{ at: at(22, 16), who: 'butler', kind: 'action', text: 'Butler sent the facts' }] }))
    expect(text).toContain('- SOW 进 P4?')
    expect(text).toContain('10-22 16:00 butler: Butler sent the facts')
  })
})
