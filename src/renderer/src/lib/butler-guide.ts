// Butler › ? : what you can ask in the chat, Chinese or English (system language first, switchable).

export type GuideLang = 'zh' | 'en'
export interface GuideRow { what: string; say: string }

export const GUIDE: Record<GuideLang, { title: string; hint: string; rows: GuideRow[]; autoTitle: string; auto: string[] }> = {
  zh: {
    title: '在 Chat 里直接说',
    hint: '点「试试」把这句话发进 Chat。',
    rows: [
      { what: '记待办', say: '记一下：周五前回 Daniel' },
      { what: '看待办', say: '我还有哪些待办？' },
      { what: '谁在等我', say: '有什么在等我？' },
      { what: '指挥 agent', say: '让 Missy 继续做 mobile e2e' },
      { what: '看 agent', say: 'Missy 做完了吗？' },
      { what: 'Jira', say: '处理一下我的 Jira' },
      { what: '看一张单', say: '看下 FAE-1422' },
      { what: '邮件', say: '整理一下邮箱' },
      { what: '计划', say: '做一下今天的计划' },
      { what: '飞书', say: 'Daniel 上周说的 Claro 那件事' }
    ],
    autoTitle: 'Butler 自己会做',
    auto: ['每 30 分钟整理邮箱、起草回信（你点了才发）', '每天早上做计划、晚上写报告', '飞书代你回：能答就答并告诉你；答不了的只给你卡片', '答应过要跟进的事，自动记成 Todo']
  },
  en: {
    title: 'Just say it in Chat',
    hint: 'Try sends the line to the Chat.',
    rows: [
      { what: 'Note a todo', say: 'Remind me to reply to Daniel by Friday' },
      { what: 'My todos', say: 'What are my todos?' },
      { what: 'Who waits', say: 'What is waiting for me?' },
      { what: 'Tell an agent', say: 'Tell Missy to continue the mobile e2e' },
      { what: 'Check an agent', say: 'Is Missy done?' },
      { what: 'Jira', say: 'Handle my Jira' },
      { what: 'One ticket', say: 'Look at FAE-1422' },
      { what: 'Email', say: 'Sort my inbox' },
      { what: 'Plan', say: "Make today's plan" },
      { what: 'Feishu', say: 'What did Daniel say about Claro last week?' }
    ],
    autoTitle: 'Butler does on its own',
    auto: ['Sorts mail every 30 min and drafts replies (sent only when you press Send)', 'Plans your morning, reports in the evening', 'Answers Feishu for you: what it can, and tells you; the rest only as a card', 'Turns what it promised to follow up into Todos']
  }
}

const KEY = 'hive:guide-lang'
export function guideLang(navLang = typeof navigator !== 'undefined' ? navigator.language : 'en'): GuideLang {
  try { const v = localStorage.getItem(KEY); if (v === 'zh' || v === 'en') return v } catch { /* private */ }
  return navLang.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}
export function setGuideLang(l: GuideLang): void { try { localStorage.setItem(KEY, l) } catch { /* private */ } }
