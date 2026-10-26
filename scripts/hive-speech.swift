#!/usr/bin/env swift

import Foundation
import Speech
import AVFoundation

// Voice input helper for Hive.
//
// Dictation (default) — listens on the default microphone and writes to
// stdout, one line each:
//   partial:<text>            live preview of the utterance in progress
//                             (macOS SFSpeechRecognizer, Mandarin)
//   speaking:                 an utterance just opened
//   audio:<wav path>\t<text>  that utterance finished: its recording, plus
//                             the macOS transcript as a fallback
//   dropped:                  that utterance was only noise; nothing follows
//   level:<dB>                loudness every ~50 ms, for the live waveform
// Every `speaking:` is answered by exactly one `audio:` or `dropped:`.
//
// Wake word (`--wake`) — always-on listening for "Hola Butler". An en-US
// recognizer that is REQUIRED to run on this Mac (no on-device model → the
// helper refuses to start) spots the phrase; nothing heard before it is
// written to disk or printed. Lines:
//   listening:                       mic and recognizer are running
//   wake:                            the phrase was heard
//   command:<wav path>\t<text>       the utterance that followed it (same
//                                    breath or the next one), plus a local
//                                    transcript as fallback
//   timeout:                         wake heard, but no command followed
//   cancel:                          "cancel" / "取消" said right after a
//                                    command (or instead of one)
//
// Hive's main process turns each `audio:` / `command:` recording into the
// final text (cloud transcription when configured, else the fallback) and
// deletes the file.
//
// `--file <16-bit mono wav>` replaces the microphone with a recording and
// skips recognition; it exists so the segmentation can be tested. With
// `--wake`, `--hear "<sec>=<text>|<sec>=<text>"` stands in for the
// recognizer: from that point of the recording, the current transcript is
// <text>.
// `--match` (with `--wake`) reads lines from stdin and prints
// `<wake 0|1>\t<cancel 0|1>\t<text after the wake phrase>` — the phrase
// lists below, testable without audio.
// `--no-preview` records from the microphone without asking macOS for
// speech recognition (diagnostics: that request aborts any process whose
// host app lacks NSSpeechRecognitionUsageDescription).

guard #available(macOS 10.15, *) else {
    fputs("error: macOS 10.15+ required\n", stderr)
    exit(1)
}

let argv = CommandLine.arguments
func argValue(_ flag: String) -> String? {
    guard let i = argv.firstIndex(of: flag), i + 1 < argv.count else { return nil }
    return argv[i + 1]
}
let wakeMode = argv.contains("--wake")
let inputFile = argValue("--file")

// ── Wake / cancel phrases ───────────────────────────────────────────────
// Kept identical to src/main/wakeWord.ts (a test runs both on one table).
// "hola" is often heard as "ola" / "holla" / "hello" and "butler" as
// "butter" by an English recognizer; accents and punctuation are folded.
let wakePhrases: [[String]] = [
    ["hola", "butler"], ["ola", "butler"], ["holla", "butler"], ["oh", "la", "butler"],
    ["hello", "butler"], ["hola", "butter"], ["ola", "butter"]
]
let cancelWords: Set<String> = ["cancel", "取消", "算了", "不要了", "别发了"]

func normTokens(_ s: String) -> [String] {
    let folded = s.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: Locale(identifier: "en_US"))
    var out: [String] = []
    var cur = ""
    for ch in folded {
        if ch.isLetter || ch.isNumber { cur.append(ch) } else if !cur.isEmpty { out.append(cur); cur = "" }
    }
    if !cur.isEmpty { out.append(cur) }
    return out
}

/// Token range of the earliest wake phrase in `tokens`, or nil.
func wakeRange(_ tokens: [String]) -> (start: Int, end: Int)? {
    var best: (start: Int, end: Int)? = nil
    for p in wakePhrases where tokens.count >= p.count {
        for i in 0...(tokens.count - p.count) where Array(tokens[i..<(i + p.count)]) == p {
            if best == nil || i < best!.start { best = (i, i + p.count) }
            break
        }
    }
    return best
}
func wakeEnd(_ tokens: [String]) -> Int? { wakeRange(tokens)?.end }

func isCancel(_ s: String) -> Bool {
    let t = normTokens(s)
    if t.isEmpty { return false }
    return cancelWords.contains(t.joined()) || (t.count <= 2 && t.contains("cancel"))
}

if wakeMode && argv.contains("--match") {
    while let line = readLine() {
        let t = normTokens(line)
        let end = wakeEnd(t)
        let rest = end.map { t[$0...].joined(separator: " ") } ?? ""
        print("\(end == nil ? 0 : 1)\t\(isCancel(line) ? 1 : 0)\t\(rest)")
    }
    exit(0)
}

let wantPreview = inputFile == nil && !argv.contains("--no-preview")
let recognizer = wantPreview ? SFSpeechRecognizer(locale: Locale(identifier: wakeMode ? "en-US" : "zh-CN")) : nil
// Post-wake only: a Mandarin transcript of the command recording, used when
// there is no cloud transcription.
let zhRecognizer = wakeMode && wantPreview ? SFSpeechRecognizer(locale: Locale(identifier: "zh-CN")) : nil

// Utterance segmentation (energy based).
let startMs = 60.0            // this much speech in a row opens an utterance
let endSilenceMs = 900.0      // this much quiet closes it
let minSpeechMs = 250.0       // shorter than this is a click / cough: dropped
let maxUtteranceMs = 60_000.0 // hard cut for someone who never pauses
let preRollMs = 300.0         // audio kept from just before speech was detected
let floorWindowMs = 8_000.0   // how far back the room-noise estimate looks
let speechMarginDb = 5.0      // speech = this far above the room noise

// Wake mode timing (audio time, so `--file` runs behave like the mic).
let commandWaitMs = 8_000.0   // after a lone "Hola Butler", wait this long for the command
let confirmWindowMs = 8_000.0 // after a command, "cancel" is listened for this long
let taskMaxMs = 50_000.0      // SFSpeech tasks stop after ~1 min: renew before that

var sampleRate = 48_000.0

// All mutable state below is touched only on `state`, except `request`,
// which the audio tap appends to under `requestLock`.
let state = DispatchQueue(label: "hive.speech.state")
let requestLock = NSLock()
var request: SFSpeechAudioBufferRecognitionRequest?
var task: SFSpeechRecognitionTask?
var previewAllowed = false
var lastTranscript = ""

var levels: [(db: Double, ms: Double)] = []
var levelsMs = 0.0
var levelEmitMs = 0.0
var inSpeech = false
var pendingStartMs = 0.0
var speechMs = 0.0
var silenceMs = 0.0
var preRoll: [Float] = []
var utterance: [Float] = []

// Wake mode state.
enum WakePhase { case idle, awaitCommand }
var phase = WakePhase.idle
var audioMs = 0.0             // audio processed so far
var requestStartMs = 0.0      // audio time the current recognition request began
var utteranceStartMs = 0.0    // audio time of utterance[0]
var wokeThisUtterance = false
var wakeEndAudioMs: Double? = nil
var awaitDeadlineMs = 0.0
var confirmUntilMs = -1.0
var fakeHears: [(ms: Double, text: String)] = []

func emit(_ line: String) {
    print(line)
    fflush(stdout)
}

func startPreview() {
    guard previewAllowed, let recognizer = recognizer, recognizer.isAvailable else { return }
    let req = SFSpeechAudioBufferRecognitionRequest()
    req.shouldReportPartialResults = true
    if wakeMode { req.requiresOnDeviceRecognition = true }
    requestLock.lock(); request = req; requestLock.unlock()
    requestStartMs = audioMs
    task = recognizer.recognitionTask(with: req) { result, _ in
        guard let result = result else { return }
        let text = result.bestTranscription.formattedString
        let segs = result.bestTranscription.segments.map { ($0.substring, $0.timestamp + $0.duration) }
        state.async {
            // A late callback from a preview we already replaced must not
            // leak into the next utterance.
            requestLock.lock(); let current = request === req; requestLock.unlock()
            guard current, text != lastTranscript else { return }
            lastTranscript = text
            if wakeMode { heard(text, segments: segs) } else { emit("partial:\(text)") }
        }
    }
}

func restartPreview() {
    requestLock.lock(); let old = request; request = nil; requestLock.unlock()
    old?.endAudio()
    task?.cancel()
    task = nil
    lastTranscript = ""
    startPreview()
}

func writeWav(_ samples: [Float]) -> String? {
    var pcm = [Int16](repeating: 0, count: samples.count)
    for i in 0..<samples.count { pcm[i] = Int16(max(-1, min(1, samples[i])) * 32767) }
    let dataBytes = UInt32(pcm.count * 2)
    var header = Data()
    func le<T: FixedWidthInteger>(_ v: T) { var x = v.littleEndian; withUnsafeBytes(of: &x) { header.append(contentsOf: $0) } }
    header.append("RIFF".data(using: .ascii)!); le(UInt32(36) + dataBytes)
    header.append("WAVEfmt ".data(using: .ascii)!); le(UInt32(16)); le(UInt16(1)); le(UInt16(1))
    le(UInt32(sampleRate)); le(UInt32(sampleRate) * 2); le(UInt16(2)); le(UInt16(16))
    header.append("data".data(using: .ascii)!); le(dataBytes)
    let body = pcm.withUnsafeBufferPointer { Data(buffer: $0) }
    let path = NSTemporaryDirectory() + "hive-speech-\(UUID().uuidString).wav"
    do {
        try (header + body).write(to: URL(fileURLWithPath: path), options: .atomic)
        return path
    } catch {
        fputs("error: could not write utterance: \(error)\n", stderr)
        return nil
    }
}

// ── Wake mode ───────────────────────────────────────────────────────────

/// A (partial) transcript of the current request.
func heard(_ text: String, segments: [(String, TimeInterval)]) {
    guard inSpeech, !wokeThisUtterance, wakeEnd(normTokens(text)) != nil else { return }
    wokeThisUtterance = true
    // Where the phrase ends in the audio, when the recognizer says
    // (partial results often carry no timings): the command is cut there.
    var flat: [(String, TimeInterval)] = []
    for (s, end) in segments { for t in normTokens(s) { flat.append((t, end)) } }
    if let i = wakeEnd(flat.map { $0.0 }), flat[i - 1].1 > 0 {
        wakeEndAudioMs = requestStartMs + flat[i - 1].1 * 1000
    }
    emit("wake:")
}

/// Mandarin transcript of a post-wake recording (on-device when the Mac
/// has the model). Calls back on `state`, at most after 4 s.
func localText(_ path: String, fallback: String, _ done: @escaping (String) -> Void) {
    guard previewAllowed, let zh = zhRecognizer, zh.isAvailable else { done(fallback); return }
    let req = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: path))
    req.shouldReportPartialResults = false
    if zh.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
    var finished = false
    let finish: (String) -> Void = { text in
        state.async {
            if finished { return }
            finished = true
            done(text.isEmpty ? fallback : text)
        }
    }
    let t = zh.recognitionTask(with: req) { result, error in
        if let result = result, result.isFinal { finish(result.bestTranscription.formattedString) } else if error != nil { finish("") }
    }
    state.asyncAfter(deadline: .now() + 4) { if !finished { t.cancel(); finish("") } }
}

func sendCommand(_ samples: [Float], fallback: String) {
    guard let path = writeWav(samples) else { return }
    localText(path, fallback: fallback) { text in
        emit("command:\(path)\t\(text.replacingOccurrences(of: "\n", with: " "))")
        confirmUntilMs = audioMs + confirmWindowMs
    }
}

/// Right after a command: was this short utterance "cancel" / "取消"?
func checkCancel(_ samples: [Float], en: String) {
    if isCancel(en) { emit("cancel:"); return }
    guard previewAllowed, let path = writeWav(samples) else { return }
    localText(path, fallback: "") { text in
        try? FileManager.default.removeItem(atPath: path)
        if isCancel(text) { emit("cancel:") }
    }
}

func wakeUtteranceEnded() {
    let transcript = lastTranscript
    let tokens = normTokens(transcript)
    if wokeThisUtterance {
        let range = wakeRange(tokens)
        let rest = range.map { tokens[$0.end...].joined(separator: " ") } ?? ""
        // Words said before the phrase in the same breath were not meant
        // for Hive. Without timings to cut them off, this recording is not
        // used at all: the next utterance becomes the command.
        let preWake = (range?.start ?? 0) > 0 && wakeEndAudioMs == nil
        var samples = utterance
        if let cut = wakeEndAudioMs {
            let skip = Int((cut - utteranceStartMs) / 1000 * sampleRate)
            if skip > 0 && skip < samples.count { samples.removeFirst(skip) }
        }
        let leftoverMs = Double(samples.count) / sampleRate * 1000
        if isCancel(rest) {
            emit("cancel:")
        } else if (!preWake && !rest.isEmpty) || (wakeEndAudioMs != nil && leftoverMs > endSilenceMs + 400) {
            sendCommand(samples, fallback: rest)
        } else {
            phase = .awaitCommand
            awaitDeadlineMs = audioMs + commandWaitMs
        }
        return
    }
    guard speechMs >= minSpeechMs else { return }
    if phase == .awaitCommand {
        phase = .idle
        if isCancel(transcript) { emit("cancel:") } else { sendCommand(utterance, fallback: transcript) }
    } else if audioMs <= confirmUntilMs {
        checkCancel(utterance, en: transcript)
    }
    // Anything else was not meant for Hive: it is dropped right here.
}

// ── Segmentation ────────────────────────────────────────────────────────

func handOver() {
    if wakeMode { wakeUtteranceEnded(); return }
    guard speechMs >= minSpeechMs, let path = writeWav(utterance) else { emit("dropped:"); return }
    emit("audio:\(path)\t\(lastTranscript.replacingOccurrences(of: "\n", with: " "))")
}

func endUtterance() {
    handOver()
    inSpeech = false
    pendingStartMs = 0
    speechMs = 0
    silenceMs = 0
    wokeThisUtterance = false
    wakeEndAudioMs = nil
    utterance.removeAll(keepingCapacity: true)
    preRoll.removeAll(keepingCapacity: true)
    restartPreview()
}

func process(_ samples: [Float]) {
    guard !samples.isEmpty else { return }
    var sum = 0.0
    for s in samples { sum += Double(s) * Double(s) }
    let db = 10 * log10(max(sum / Double(samples.count), 1e-12))
    let ms = Double(samples.count) / sampleRate * 1000
    audioMs += ms
    if !wakeMode {
        levelEmitMs += ms
        if levelEmitMs >= 50 { levelEmitMs = 0; emit("level:\(Int(db.rounded()))") }
    }
    if wakeMode {
        while let next = fakeHears.first, next.ms <= audioMs {
            fakeHears.removeFirst()
            lastTranscript = next.text
            heard(next.text, segments: [])
        }
        if phase == .awaitCommand && !inSpeech && audioMs > awaitDeadlineMs {
            phase = .idle
            emit("timeout:")
        }
        // Renew the recognition task in a pause, well inside its limit.
        if !inSpeech && audioMs - requestStartMs > taskMaxMs { restartPreview() }
    }
    // Room noise = a low percentile of recent loudness. It must keep
    // adapting while someone talks (a floor that only updates in "quiet"
    // never recovers from one wrong guess: a room at -43 dB read as all
    // speech), and the gaps between words keep the low percentile honest.
    levels.append((db, ms)); levelsMs += ms
    while levelsMs > floorWindowMs, let first = levels.first { levelsMs -= first.ms; levels.removeFirst() }
    let sorted = levels.map { $0.db }.sorted()
    let floorDb = levelsMs < 1000 ? sorted[0] : sorted[sorted.count / 10]
    let loud = db > min(floorDb + speechMarginDb, -20)

    if !inSpeech {
        preRoll.append(contentsOf: samples)
        let keep = Int(preRollMs / 1000 * sampleRate)
        if preRoll.count > keep { preRoll.removeFirst(preRoll.count - keep) }
        pendingStartMs = loud ? pendingStartMs + ms : 0
        if pendingStartMs >= startMs {
            if !wakeMode { emit("speaking:") }
            inSpeech = true
            utterance = preRoll
            utteranceStartMs = audioMs - Double(preRoll.count) / sampleRate * 1000
            speechMs = pendingStartMs
            silenceMs = 0
        }
        return
    }

    utterance.append(contentsOf: samples)
    if loud { speechMs += ms; silenceMs = 0 } else { silenceMs += ms }
    let totalMs = Double(utterance.count) / sampleRate * 1000
    if silenceMs >= endSilenceMs || totalMs >= maxUtteranceMs { endUtterance() }
}

if let inputFile = inputFile {
    // Test mode: feed a recording through the same segmentation.
    guard let data = FileManager.default.contents(atPath: inputFile), data.count > 44 else {
        fputs("error: cannot read \(inputFile)\n", stderr)
        exit(1)
    }
    if let spec = argValue("--hear") {
        for part in spec.split(separator: "|") {
            let kv = part.split(separator: "=", maxSplits: 1).map(String.init)
            if kv.count == 2, let sec = Double(kv[0]) { fakeHears.append((sec * 1000, kv[1])) }
        }
        fakeHears.sort { $0.ms < $1.ms }
    }
    sampleRate = Double(data.subdata(in: 24..<28).withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }.littleEndian)
    let pcm = data.subdata(in: 44..<data.count).withUnsafeBytes { Array($0.bindMemory(to: Int16.self)) }
    if wakeMode { emit("listening:") }
    var i = 0
    while i < pcm.count {
        let end = min(i + 1024, pcm.count)
        process(pcm[i..<end].map { Float(Int16(littleEndian: $0)) / 32768 })
        i = end
    }
    if inSpeech { handOver() }
    exit(0)
} else {
    if wakeMode {
        // Privacy rule: the always-on recognizer must never send audio off
        // this Mac. Without an on-device English model there is no wake word.
        guard let r = recognizer, r.supportsOnDeviceRecognition else {
            fputs("error: on-device English speech recognition is not available on this Mac\n", stderr)
            exit(2)
        }
    }

    let audioEngine = AVAudioEngine()
    let inputNode = audioEngine.inputNode
    let format = inputNode.outputFormat(forBus: 0)
    sampleRate = format.sampleRate

    inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
        requestLock.lock(); let req = request; requestLock.unlock()
        req?.append(buffer)
        guard let channel = buffer.floatChannelData?[0] else { return }
        let samples = Array(UnsafeBufferPointer(start: channel, count: Int(buffer.frameLength)))
        state.async { process(samples) }
    }

    audioEngine.prepare()
    do {
        try audioEngine.start()
    } catch {
        fputs("error: audio engine failed to start: \(error)\n", stderr)
        exit(1)
    }
    fputs("listening\n", stderr)

    // Dictation: the preview is optional — without speech-recognition
    // permission the helper still records utterances for cloud
    // transcription. Wake mode cannot work without it.
    if wantPreview {
        SFSpeechRecognizer.requestAuthorization { status in
            state.async {
                if status == .authorized {
                    previewAllowed = true
                    startPreview()
                    if wakeMode { emit("listening:") }
                } else if wakeMode {
                    fputs("error: speech recognition not allowed (status \(status.rawValue))\n", stderr)
                    exit(3)
                } else {
                    fputs("note: live preview unavailable (speech recognition status \(status.rawValue))\n", stderr)
                }
            }
        }
    }

    // Stop: dictation hands over whatever was being said, then exits. In
    // wake mode a half-said command is dropped (stop means stop listening).
    signal(SIGINT, SIG_IGN)
    signal(SIGTERM, SIG_IGN)
    var signalSources: [DispatchSourceSignal] = []
    for sig in [SIGINT, SIGTERM] {
        let src = DispatchSource.makeSignalSource(signal: sig, queue: state)
        src.setEventHandler {
            audioEngine.stop()
            inputNode.removeTap(onBus: 0)
            if inSpeech && !wakeMode { handOver() }
            exit(0)
        }
        src.resume()
        signalSources.append(src)
    }

    RunLoop.main.run()
}
