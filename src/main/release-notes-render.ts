// v2.14.0 — pure renderer for the "Update available" BrowserWindow.
//
// Why not dialog.showMessageBox?
// On macOS the built-in message-box is an NSAlert: its `detail` slot is
// plain text (no markdown), doesn't scroll, and truncates around a few
// hundred characters. v2.13.0's release-notes dump was hitting all three
// walls at once — user saw raw '## Fix' / '**bold**', then "(truncated)"
// with no way to see the rest.
//
// This function synthesizes a self-contained HTML document (inline CSS,
// no external assets) matching Hive's dark palette. Kept as a pure
// function so it's trivial to snapshot-test — no BrowserWindow required.

import { marked } from 'marked'

export interface RenderInputs {
  currentVersion: string      // e.g. "2.10.0"
  latestVersion: string       // e.g. "2.13.0"  (tag with 'v' prefix stripped)
  releaseTitle: string        // release name from GitHub, may be empty
  bodyMarkdown: string        // release body — full length, no truncation
  releaseUrl: string          // GitHub release page URL
  hasDmg: boolean             // whether Download & Install button should render
}

/**
 * Render release notes as a full self-contained HTML page.
 *
 * The page has three parts:
 *   1. Header — version diff (current → latest) + release title
 *   2. Scrollable body — marked-rendered markdown
 *   3. Sticky footer — action buttons (Download, View on GitHub, Later)
 *      + an initially-hidden progress bar that main-process fills in
 *
 * All CSS is inline. The page communicates back via `window.hiveRelease.*`
 * IPC that release-notes-window.ts exposes through a preload script.
 */
export function renderReleaseNotesHTML(inputs: RenderInputs): string {
  const bodyHtml = String(marked.parse(inputs.bodyMarkdown || '_No release notes provided._', { async: false }))
  const title = escapeHtml(inputs.releaseTitle || `Hive v${inputs.latestVersion}`)
  const currentEsc = escapeHtml(inputs.currentVersion)
  const latestEsc = escapeHtml(inputs.latestVersion)
  const urlEsc = escapeHtml(inputs.releaseUrl)

  const downloadBtn = inputs.hasDmg
    ? `<button class="btn btn-primary" data-action="download">Download & Install</button>`
    : ''

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  :root {
    --bg-primary: #0f0a1a;
    --bg-secondary: #1a1128;
    --bg-hover: rgba(196, 160, 255, 0.08);
    --text-primary: #f4f0ff;
    --text-muted: #9888c0;
    --border: rgba(196, 160, 255, 0.15);
    --accent: #c4a0ff;
    --accent-hover: #d4b8ff;
    --code-bg: #251838;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; height: 100%;
    background: var(--bg-primary); color: var(--text-primary);
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif;
    font-size: 13px; line-height: 1.55;
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
  }
  .app { display: flex; flex-direction: column; height: 100vh; }
  .header {
    padding: 20px 24px 16px; border-bottom: 1px solid var(--border);
    background: var(--bg-secondary); -webkit-app-region: drag;
  }
  .header h1 { margin: 0 0 6px; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
  .version-diff {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums;
  }
  .version-diff .cur { text-decoration: line-through; opacity: 0.7; }
  .version-diff .arrow { opacity: 0.5; }
  .version-diff .new { color: var(--accent); font-weight: 600; }

  .notes {
    flex: 1; overflow-y: auto; overflow-x: hidden;
    padding: 20px 24px; scroll-behavior: smooth;
  }
  .notes::-webkit-scrollbar { width: 8px; }
  .notes::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
  .notes::-webkit-scrollbar-thumb:hover { background: var(--accent); }

  .notes h1, .notes h2, .notes h3, .notes h4 {
    margin: 20px 0 10px; line-height: 1.3; letter-spacing: -0.01em;
  }
  .notes h1 { font-size: 17px; }
  .notes h2 { font-size: 15px; color: var(--accent); }
  .notes h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }
  .notes h4 { font-size: 12px; }
  .notes > *:first-child { margin-top: 0; }
  .notes p { margin: 8px 0; }
  .notes ul, .notes ol { margin: 8px 0; padding-left: 22px; }
  .notes li { margin: 3px 0; }
  .notes li > ul, .notes li > ol { margin: 3px 0; }
  .notes code {
    background: var(--code-bg); padding: 1px 6px; border-radius: 3px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 11.5px;
    color: var(--accent);
  }
  .notes pre {
    background: var(--code-bg); padding: 10px 12px; border-radius: 6px;
    overflow-x: auto; margin: 10px 0;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 11.5px;
  }
  .notes pre code { background: transparent; padding: 0; color: var(--text-primary); }
  .notes a { color: var(--accent); text-decoration: none; }
  .notes a:hover { text-decoration: underline; }
  .notes strong { font-weight: 600; color: var(--text-primary); }
  .notes em { font-style: italic; color: var(--text-primary); opacity: 0.9; }
  .notes blockquote {
    margin: 10px 0; padding: 6px 12px; border-left: 3px solid var(--accent);
    background: var(--bg-hover); color: var(--text-muted);
  }
  .notes hr { border: 0; border-top: 1px solid var(--border); margin: 16px 0; }

  .footer {
    padding: 14px 20px; border-top: 1px solid var(--border);
    background: var(--bg-secondary);
    display: flex; flex-direction: column; gap: 10px;
  }
  .actions { display: flex; gap: 8px; justify-content: flex-end; align-items: center; }
  .actions .spacer { flex: 1; }
  .btn {
    -webkit-app-region: no-drag;
    padding: 7px 14px; border-radius: 6px; border: 1px solid var(--border);
    background: var(--bg-primary); color: var(--text-primary);
    font-size: 12px; font-weight: 500; cursor: pointer;
    transition: background 120ms, border-color 120ms, color 120ms, transform 60ms;
  }
  .btn:hover { background: var(--bg-hover); border-color: var(--accent); }
  .btn:active { transform: translateY(1px); }
  .btn-primary {
    background: var(--accent); border-color: var(--accent); color: #1a0b2e; font-weight: 600;
  }
  .btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
  .btn-ghost { background: transparent; }

  .progress { display: none; }
  .progress.on { display: block; }
  .progress-bar {
    height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; margin-bottom: 6px;
  }
  .progress-fill {
    height: 100%; background: var(--accent); width: 0%;
    transition: width 200ms ease-out;
  }
  .progress-label {
    font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums;
    display: flex; justify-content: space-between;
  }
  .progress-label .status { color: var(--accent); font-weight: 500; }
</style>
</head>
<body>
<div class="app">
  <div class="header">
    <h1>${title}</h1>
    <div class="version-diff">
      <span class="cur">v${currentEsc}</span>
      <span class="arrow">→</span>
      <span class="new">v${latestEsc}</span>
    </div>
  </div>

  <div class="notes" id="notes">${bodyHtml}</div>

  <div class="footer">
    <div class="progress" id="progress">
      <div class="progress-bar"><div class="progress-fill" id="fill"></div></div>
      <div class="progress-label">
        <span class="status" id="statusText">Preparing…</span>
        <span id="pct">0%</span>
      </div>
    </div>
    <div class="actions">
      <button class="btn btn-ghost" data-action="view-github">View on GitHub ↗</button>
      <div class="spacer"></div>
      <button class="btn" data-action="later">Later</button>
      ${downloadBtn}
    </div>
  </div>
</div>

<script>
  const RELEASE_URL = ${JSON.stringify(inputs.releaseUrl)};
  const api = window.hiveRelease || {};
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const action = t.dataset.action;
    if (!action) return;
    if (action === 'view-github') { api.openExternal?.(RELEASE_URL); return; }
    if (action === 'later')       { api.close?.(); return; }
    if (action === 'download')    { startDownload(); return; }
  });
  function startDownload() {
    document.querySelectorAll('button[data-action="download"]').forEach(b => { b.disabled = true; b.textContent = 'Downloading…'; });
    document.getElementById('progress').classList.add('on');
    api.download?.();
  }
  // Main-process → renderer progress updates
  api.onProgress?.((state) => {
    const pct = Math.max(0, Math.min(100, Math.round(state.percent || 0)));
    document.getElementById('fill').style.width = pct + '%';
    document.getElementById('pct').textContent = pct + '%';
    if (state.label) document.getElementById('statusText').textContent = state.label;
  });
  api.onDone?.((info) => {
    document.getElementById('fill').style.width = '100%';
    document.getElementById('pct').textContent = '100%';
    document.getElementById('statusText').textContent = info?.error ? ('Failed: ' + info.error) : 'Installer opened. Drag Hive → Applications, then quit this window.';
    if (!info?.error) {
      document.querySelectorAll('button[data-action="later"]').forEach(b => { b.textContent = 'Close'; });
    }
  });
</script>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
