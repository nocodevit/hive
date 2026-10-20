// "Ready-to-send" text (an email, a chat message, an announcement) goes in
// a ```deliverable fence so the chat can show it as a card with one Copy
// button. Agents learn the convention from DELIVERABLE_RULE (in their
// definition file and in Butler's CLAUDE.md).

export const DELIVERABLE_LANG = 'deliverable'

export const DELIVERABLE_RULE = `## Ready-to-send text
When you write something the user will send or paste as-is (an email, a chat message, an announcement, a reply), put exactly that text in a fenced block with the language \`deliverable\`. An optional first line \`title: <what it is · for whom>\` labels it. Nothing else goes inside the block: no notes, no placeholders you expect them to fill unless marked [like this].

\`\`\`deliverable
title: Email · to Lin
Hi Lin, UAT was down 09:05–10:20 and is back now. Thanks for flagging it.
\`\`\`
`

/** Split a deliverable block into its optional title and the text to copy. */
export function parseDeliverable(raw: string): { title: string; body: string } {
  const text = raw.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '')
  const m = text.match(/^title:[ \t]*(.*)\n?/i)
  if (!m) return { title: '', body: text }
  return { title: m[1].trim(), body: text.slice(m[0].length).replace(/^\n+/, '') }
}
