# Self-update

Hive → Check for Updates… (also checked once every 24 h) reads the latest
GitHub release (`updater.ts`) and shows its notes
(`release-notes-window.ts`). From v2.27.0 "Download & Install" really
installs; before that it only opened the disk image, and dragging Hive
into Applications failed because Hive was still running.

## Flow

1. Download the release's arm64 `.dmg` to `~/Downloads`.
2. `prepareUpdate` (`selfUpdate.ts`): mount the image quietly, then accept
   the Hive inside only if
   - its code signature verifies (`codesign --verify --deep --strict`),
   - it has the same bundle id and a **newer** version than the installed app,
   - and, when the installed app is signed by a developer team, the same
     Team ID signed it.
   A copy is staged at `<install dir>/.Hive-update-<version>/Hive.app`,
   verified again, and the image is unmounted. Nothing installed has
   changed yet.
3. The window shows **Install & Restart**. Clicking it starts
   `INSTALL_SCRIPT` detached and quits Hive. The script waits for the Hive
   process to exit (60 s max, else it does nothing), moves the old bundle
   aside, moves the staged one in, deletes the old one, and reopens Hive.
   If the new bundle cannot be moved in, the old one is put back.
4. Quitting stops running chats. Their open-chat records survive
   (`openChats.ts`), so the relaunched Hive offers to resume them.

## When it cannot install by itself

Development build, Hive running from a translocated path or a disk image,
no write access next to the app, or any failed check in step 2: the disk
image is opened as before, the window says why, and offers **Quit Hive**
so the manual drag can succeed.

## Rehearsing

`HIVE_RELEASES_API=http://127.0.0.1:<port>/…` points the check at a local
server (loopback only; anything else is ignored) and
`HIVE_UPDATE_NO_RELAUNCH=1` skips the reopen. With a copy of the app in a
temp folder plus `HIVE_DATA_DIR` / `HIVE_PORT`, the whole flow can be run
without touching the real install. `selfUpdate.test.ts` covers the checks
with real disk images and the swap script with fake bundles.
