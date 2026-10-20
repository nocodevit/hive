---
name: sort-inbox
description: Sort the owner's new email into reply now / read later / ignore, with one line each. Use when the owner asks to sort or check their inbox.
---

## Purpose

Sort new email so the owner sees in seconds what needs a reply.

## Input

- New emails since the last sort: sender, subject, first lines, date.
- `profile.md`: who the owner works with and is responsible for.

## Rules

- Three groups: **Reply** (someone waits for the owner), **Read** (useful, no reply needed), **Ignore** (newsletters, notifications, ads).
- Customers and people in "works with" go to Reply when they ask something.
- One line per email: sender · what they want, in their words.
- Never open links or attachments.
- Never delete, archive or mark anything; only sort.

## Ask me first

- 🔒 changes — never delete, move, archive or mark email
- 🔒 sending — never reply from here; drafting is reply-email's job

## Tone and format

- Group headings with counts: **Reply (2)**.
- Reply group first, most urgent on top.
- Ignore group collapsed to one line with a count.

## Examples

> **Reply (2)**
> - Lin (customer) · dashboard shows no data since morning
> - Ben · needs the demo scope by Thursday
> **Read (1)**
> - PMO · sprint review notes
> **Ignore (14)**

## Output

- The sorted list as markdown.
- For each Reply item, the email id so reply-email can draft it.
- Nothing is changed in the mailbox.
