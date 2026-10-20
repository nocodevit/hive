import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { hiveChatLogsDir } from '../chat-recent-sessions'

describe('hiveChatLogsDir', () => {
  const saved = process.env.HIVE_DATA_DIR
  afterEach(() => {
    if (saved === undefined) delete process.env.HIVE_DATA_DIR
    else process.env.HIVE_DATA_DIR = saved
  })

  it('uses HIVE_DATA_DIR when set', () => {
    process.env.HIVE_DATA_DIR = '/tmp/hive-isolated'
    expect(hiveChatLogsDir()).toBe(join('/tmp/hive-isolated', 'chat-logs'))
  })

  it('falls back to ~/.hive', () => {
    delete process.env.HIVE_DATA_DIR
    expect(hiveChatLogsDir()).toBe(join(homedir(), '.hive', 'chat-logs'))
  })
})
