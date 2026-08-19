import { describe, it, expect } from 'vitest'
import { compareVersions, pickDmgAsset } from '../updater'

describe('updater (v2.4.0)', () => {
  describe('compareVersions', () => {
    it('detects strictly newer patches', () => {
      expect(compareVersions('2.3.1', '2.3.0')).toBeGreaterThan(0)
      expect(compareVersions('v2.3.1', 'v2.3.0')).toBeGreaterThan(0)
    })
    it('detects older versions', () => {
      expect(compareVersions('2.3.0', '2.4.0')).toBeLessThan(0)
    })
    it('equal versions return 0', () => {
      expect(compareVersions('2.3.0', 'v2.3.0')).toBe(0)
    })
    it('minor version bumps outweigh patch differences', () => {
      expect(compareVersions('2.4.0', '2.3.99')).toBeGreaterThan(0)
    })
    it('handles v-prefix and no-prefix interchangeably', () => {
      expect(compareVersions('v3.0.0', '2.99.99')).toBeGreaterThan(0)
    })
    it('ignores pre-release suffixes (2.3.0-beta = 2.3.0)', () => {
      expect(compareVersions('2.3.0-beta', '2.3.0')).toBe(0)
    })
    it('missing components default to 0', () => {
      expect(compareVersions('3', '2.99.99')).toBeGreaterThan(0)
      expect(compareVersions('3.1', '3.0.99')).toBeGreaterThan(0)
    })
  })

  describe('pickDmgAsset', () => {
    const mk = (name: string) => ({ name, browser_download_url: `https://example.com/${name}`, size: 100 })
    const release = (assets: Array<{ name: string }>) => ({
      tag_name: 'v2.4.0', name: 'v2.4.0', body: '', html_url: '',
      assets: assets.map(a => mk(a.name))
    })

    it('prefers arm64-tagged .dmg when both are available', () => {
      const r = release([{ name: 'Hive-2.4.0.dmg' }, { name: 'Hive-2.4.0-arm64.dmg' }])
      expect(pickDmgAsset(r)?.name).toBe('Hive-2.4.0-arm64.dmg')
    })

    it('recognizes aarch64 as an arm64 alias', () => {
      const r = release([{ name: 'Hive-2.4.0.dmg' }, { name: 'Hive-2.4.0-aarch64.dmg' }])
      expect(pickDmgAsset(r)?.name).toBe('Hive-2.4.0-aarch64.dmg')
    })

    it('falls back to any .dmg when no arch-specific one exists', () => {
      const r = release([{ name: 'Hive-2.4.0.dmg' }])
      expect(pickDmgAsset(r)?.name).toBe('Hive-2.4.0.dmg')
    })

    it('returns null when no .dmg present (e.g. only .zip / .exe)', () => {
      const r = release([{ name: 'Hive-2.4.0.zip' }, { name: 'Hive-2.4.0.exe' }])
      expect(pickDmgAsset(r)).toBeNull()
    })

    it('returns null on empty assets list', () => {
      expect(pickDmgAsset({ tag_name: 'v', name: 'v', body: '', html_url: '', assets: [] })).toBeNull()
    })
  })
})
