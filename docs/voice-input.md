# Voice input

Dictation into the chat composer: speech becomes text in the input box;
nothing is sent until the user presses Enter.

## Pipeline

1. `scripts/hive-speech` (Swift, compiled from `hive-speech.swift`) listens
   on the default microphone and prints, per line:
   - `partial:<text>` — live preview from macOS `SFSpeechRecognizer`
     (one language at a time: zh-CN or en-US, the 中/EN toggle).
   - `audio:<wav path>\t<macOS text>` — one finished utterance.
   Utterances are cut by loudness: speech is anything ≥ 5 dB above the
   room noise (10th percentile of the last 8 s), a 0.9 s pause ends one,
   60 s is the hard cap, anything under 0.25 s of speech is dropped.
2. Main (`src/main/voiceTranscribe.ts`, wired in `index.ts`) resolves each
   `audio:` line, strictly in order, to `final:<text>`:
   - **OpenAI key set** (App Settings → Voice Input): the WAV is uploaded
     to `/v1/audio/transcriptions`. This is what makes mixed 中文/English
     in one sentence work. The prompt carries project/agent names (spelling
     hint) and the previous utterance (context); the 中/EN toggle is sent
     as the language hint.
   - **No key, offline, or any API error**: the macOS text is used.
   The recording is deleted either way.
3. `speech:stop` waits for the helper to hand over the sentence in
   progress and for its transcription before returning, so the last words
   are not lost.

## Models

`gpt-4o-mini-transcribe` (default, cheapest) or `gpt-transcribe`. Measured
on the owner's own recording (2026-10-12): both got a 10 s mixed sentence
right; on a 2 s quiet "说好了" the mini model returned Korean / wrong
words, `gpt-transcribe` with the `zh` hint was right twice.

## Auto-send

Off by default (composer pill 自动发送, or App Settings → Voice Input).
When on, dictated text is sent once the speaker is done:

- The helper brackets every utterance: `speaking:` when it opens, then
  exactly one `audio:` (→ `final:`) or `dropped:` (it was only noise).
- `lib/voice-autosend.ts` (`autoSendStep`) arms a countdown when every
  opened utterance has been answered AND fresh dictation is sitting in the
  input. Default pause 2.5 s (1–10 s, in settings).
- Cancelled by: speaking again, typing, clicking the countdown, stopping
  the mic, switching auto-send off. Text the user typed or edited by hand
  is never auto-sent on its own — only after new speech.
- After a send the mic keeps listening, so messages can follow each other.

## Failure handling

- Cloud call fails (bad key, offline, timeout): that utterance uses the
  macOS text, and the mic pill shows one `⚠` notice for the session.
- Helper exits by itself (no microphone permission, device removed): main
  sends `exit:<reason>`; the pill returns to idle and shows the reason.
- App quit: the helper is killed so nothing keeps the microphone open.

## Testing without a microphone

`scripts/hive-speech --file <16-bit mono wav>` runs a recording through
the same segmentation and prints the `audio:` lines
(`hive-speech-segmentation.test.ts`). `--no-preview` records from the
microphone without requesting speech recognition. The process plumbing is
covered with a fake helper (`voiceTranscribe.test.ts`), the window side
with stubbed IPC (`e2e/voice-input.spec.ts`). The live preview needs the app's
`NSSpeechRecognitionUsageDescription`, so the helper only fully works
when launched by the packaged app.

After editing the Swift source: `swiftc -O scripts/hive-speech.swift -o scripts/hive-speech`.
