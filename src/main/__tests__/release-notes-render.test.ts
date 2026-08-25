// v2.14.0 — pure renderer tests for the update-window HTML.
//
// The rendered HTML is generated in main-process code but has NO
// Electron dependency, so we can test it as a plain string in vitest.
// Ensures the four bugs v2.14.0 fixed (no markdown / no scroll / lost
// on link click / no download progress) don't silently regress.

import { describe, it, expect } from 'vitest'
import { renderReleaseNotesHTML } from '../release-notes-render'

const BASE = {
  currentVersion: '2.10.0',
  latestVersion: '2.14.0',
  releaseTitle: 'Hive v2.14.0 — better update window',
  bodyMarkdown: '## Fix\n\n- **Markdown** renders now\n- Long notes _scroll_\n- `code` styled\n\n### Details\n\nSee [the PR](https://example.com/pr/1) for context.',
  releaseUrl: 'https://github.com/nocodevit/hive/releases/tag/v2.14.0',
  hasDmg: true
}

describe('renderReleaseNotesHTML — markdown renders (not raw)', () => {
  it('converts ## headings to <h2>', () => {
    const html = renderReleaseNotesHTML(BASE)
    expect(html).toMatch(/<h2[^>]*>Fix<\/h2>/)
  })

  it('converts - bullets to <ul><li>', () => {
    const html = renderReleaseNotesHTML(BASE)
    expect(html).toMatch(/<ul>[\s\S]*<li>[\s\S]*<\/li>[\s\S]*<\/ul>/)
  })

  it('converts **bold** to <strong>', () => {
    const html = renderReleaseNotesHTML(BASE)
    expect(html).toMatch(/<strong>Markdown<\/strong>/)
  })

  it('converts `code` to <code>', () => {
    const html = renderReleaseNotesHTML(BASE)
    expect(html).toMatch(/<code>code<\/code>/)
  })

  it('converts [text](url) to <a href>', () => {
    const html = renderReleaseNotesHTML(BASE)
    expect(html).toMatch(/<a href="https:\/\/example\.com\/pr\/1">the PR<\/a>/)
  })

  it('does NOT emit raw markdown fences into the page', () => {
    const html = renderReleaseNotesHTML(BASE)
    // The '##' should be converted to <h2>, not left as literal chars
    // inside the notes container. Find the notes block and assert.
    const notes = html.match(/<div class="notes" id="notes">([\s\S]*?)<\/div>\s*<div class="footer">/)
    expect(notes).toBeTruthy()
    expect(notes![1]).not.toContain('## Fix')
    expect(notes![1]).not.toContain('**Markdown**')
  })
})

describe('renderReleaseNotesHTML — no truncation', () => {
  it('renders the FULL body without any (truncated) marker', () => {
    const huge = 'lorem ipsum dolor sit amet '.repeat(200)  // ~5400 chars
    const html = renderReleaseNotesHTML({ ...BASE, bodyMarkdown: huge })
    expect(html).toContain('lorem ipsum')
    // The count of "lorem ipsum" should match the original — no slicing.
    const matches = html.match(/lorem ipsum/g) || []
    expect(matches.length).toBe(200)
    expect(html).not.toContain('(truncated)')
    expect(html).not.toContain('…(truncated)')
  })
})

describe('renderReleaseNotesHTML — scrollable notes container', () => {
  it('gives the notes div overflow-y: auto so long content scrolls', () => {
    const html = renderReleaseNotesHTML(BASE)
    // The .notes rule must set overflow-y: auto.
    expect(html).toMatch(/\.notes\s*\{[^}]*overflow-y:\s*auto/)
  })

  it('marks .notes as flex: 1 so it takes remaining vertical space', () => {
    const html = renderReleaseNotesHTML(BASE)
    expect(html).toMatch(/\.notes\s*\{[^}]*flex:\s*1/)
  })
})

describe('renderReleaseNotesHTML — header shows version diff', () => {
  it('displays current version struck-through and latest highlighted', () => {
    const html = renderReleaseNotesHTML(BASE)
    expect(html).toContain('v2.10.0')
    expect(html).toContain('v2.14.0')
    expect(html).toMatch(/<span class="cur">v2\.10\.0<\/span>/)
    expect(html).toMatch(/<span class="new">v2\.14\.0<\/span>/)
  })

  it('renders the release title in the header <h1>', () => {
    const html = renderReleaseNotesHTML(BASE)
    expect(html).toMatch(/<h1>Hive v2\.14\.0 — better update window<\/h1>/)
  })

  it('falls back to a generated title if releaseTitle is empty', () => {
    const html = renderReleaseNotesHTML({ ...BASE, releaseTitle: '' })
    expect(html).toMatch(/<h1>Hive v2\.14\.0<\/h1>/)
  })
})

describe('renderReleaseNotesHTML — action buttons', () => {
  it('renders Download button when hasDmg is true', () => {
    const html = renderReleaseNotesHTML(BASE)
    expect(html).toMatch(/<button[^>]*data-action="download"[^>]*>Download & Install<\/button>/)
  })

  it('omits Download button when hasDmg is false', () => {
    const html = renderReleaseNotesHTML({ ...BASE, hasDmg: false })
    // JS handler code references the selector as a string literal; check
    // for the actual <button> element instead.
    expect(html).not.toMatch(/<button[^>]*data-action="download"/)
  })

  it('always renders View on GitHub button', () => {
    expect(renderReleaseNotesHTML(BASE)).toMatch(/data-action="view-github"/)
    expect(renderReleaseNotesHTML({ ...BASE, hasDmg: false })).toMatch(/data-action="view-github"/)
  })

  it('always renders Later button', () => {
    expect(renderReleaseNotesHTML(BASE)).toMatch(/data-action="later"/)
  })
})

describe('renderReleaseNotesHTML — progress bar wiring', () => {
  it('includes a progress element hidden by default', () => {
    const html = renderReleaseNotesHTML(BASE)
    expect(html).toMatch(/<div class="progress" id="progress">/)
    // The .progress rule defaults to display:none until .on is added.
    expect(html).toMatch(/\.progress\s*\{[^}]*display:\s*none/)
    expect(html).toMatch(/\.progress\.on\s*\{[^}]*display:\s*block/)
  })

  it('wires window.hiveRelease.onProgress → progress-fill width', () => {
    const html = renderReleaseNotesHTML(BASE)
    expect(html).toContain('api.onProgress')
    expect(html).toContain("getElementById('fill').style.width")
  })

  it('wires the Download button click to startDownload()', () => {
    const html = renderReleaseNotesHTML(BASE)
    expect(html).toContain('startDownload()')
    expect(html).toContain('api.download')
  })
})

describe('renderReleaseNotesHTML — link click preserves window', () => {
  it('View on GitHub calls api.openExternal — NOT api.close', () => {
    const html = renderReleaseNotesHTML(BASE)
    // The click handler for view-github must go through openExternal
    // and MUST NOT close the window.
    expect(html).toMatch(/action === 'view-github'[^;]*openExternal\?\.\(RELEASE_URL\)/)
    // Extract the view-github branch (roughly) and assert no close call there.
    const branch = html.match(/action === 'view-github'[^}]*/)?.[0] || ''
    expect(branch).not.toContain('api.close')
  })

  it('embeds the correct release URL for the GitHub button', () => {
    const html = renderReleaseNotesHTML(BASE)
    expect(html).toContain('"https://github.com/nocodevit/hive/releases/tag/v2.14.0"')
  })
})

describe('renderReleaseNotesHTML — XSS safety', () => {
  it('escapes < > & " \' in title and version fields', () => {
    const html = renderReleaseNotesHTML({
      ...BASE,
      releaseTitle: '<script>alert("xss")</script>',
      latestVersion: '2.14.0"><img>',
      currentVersion: '&<>"\''
    })
    expect(html).not.toContain('<script>alert("xss")</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('"><img>')
    expect(html).toContain('&quot;&gt;&lt;img&gt;')
    // currentVersion appears inside the version-diff <span class="cur">.
    expect(html).toContain('&amp;&lt;&gt;&quot;&#39;')
  })
})
