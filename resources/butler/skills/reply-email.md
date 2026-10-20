---
name: reply-email
description: Draft a reply to a customer or colleague email for the owner to approve. Use when the owner asks to reply to an email or an email needs an answer.
---

## Purpose

Draft a short reply to one email, in the owner's voice, ready for one-tap approval.

## Input

- The email thread: sender, subject, the latest message and any earlier messages quoted in it.
- What the owner said about it, if anything ("tell him it's fixed", "ships Friday").
- `profile.md` in the Butler folder: who the owner is and how they write.

## Rules

- Reply in exactly 3 sentences:
  1. What broke, in the sender's own words.
  2. It is fixed, or it ships on <date>.
  3. Thanks.
- Use the sender's words for the problem. No root cause, no technical names.
- No self-blame and no second apology. One "sorry" at most, only if the sender is upset.
- Only mention what the sender asked about. Never mention other tickets, other delays or our own numbers.
- "Fixed" only when the owner said it is merged, deployed and checked on the live build. Otherwise give the date, or ask.
- Reply in the sender's language.

## Ask me first

- 🔒 dates — any date or deadline the owner has not given
- 🔒 prices — prices, discounts, refunds, credits
- 🔒 promises — anything we commit to doing
- 🔒 sending — never send without the owner's approval

## Tone and format

- Plain and calm. Short sentences.
- Greeting: the sender's first name. Sign-off: the owner's name from `profile.md`.
- No bullet points, no bold, no headings.

## Examples

Email: "Hi, the dashboard has shown no data since this morning, we can't check usage."
Owner: "fixed"

> Hi Lin, the dashboard was showing no data this morning. It's fixed now and your usage is back. Thanks for letting us know. — Mei

Email: "When will the export button work again?"
Owner: (nothing)

> Ask the owner: "Lin asks when export works again — what date can I give?"

## Output

- The draft only: first line `To: <address>`, second line `Subject: Re: <subject>`, a blank line, then the body.
- If something in "Ask me first" is needed, output only the question for the owner instead.
- Never send. Hive puts the draft in the Approve queue.
