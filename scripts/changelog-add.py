#!/usr/bin/env python3
"""Put a release's notes at the top of CHANGELOG.md: scripts/changelog-add.py 2.38.1 notes.md
The same notes go to the GitHub release (gh release create … --notes-file notes.md),
so CHANGELOG.md, the release page and Hive's update window always say the same thing."""
import re, sys, datetime
version, notes_file = sys.argv[1].lstrip('v'), sys.argv[2]
notes = open(notes_file).read().strip()
path = 'CHANGELOG.md'
s = open(path).read()
if f'## [{version}]' in s:
    sys.exit(f'CHANGELOG.md already has {version}')
notes = re.sub(r'^(#+) ', lambda m: '#' * min(6, len(m.group(1)) + 2) + ' ', notes, flags=re.M)
entry = f"## [{version}] — {datetime.date.today().isoformat()}\n\n{notes}\n\n---\n\n"
i = s.index('## [')
open(path, 'w').write(s[:i] + entry + s[i:])
print(f'CHANGELOG.md: added {version}')
