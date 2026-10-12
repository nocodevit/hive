#!/usr/bin/env swift

import Foundation
import Speech
import AVFoundation

// Voice input helper for Hive.
//
// Listens on the default microphone and writes to stdout, one line each:
//   partial:<text>            live preview of the utterance in progress
//                             (macOS SFSpeechRecognizer, single language)
//   speaking:                 an utterance just opened
//   audio:<wav path>\t<text>  that utterance finished: its recording, plus
//                             the macOS transcript as a fallback
//   dropped:                  that utterance was only noise; nothing follows
// Every `speaking:` is answered by exactly one `audio:` or `dropped:`.
//
// Hive's main process turns each `audio:` line into the final text (cloud
// transcription when configured, else the fallback) and deletes the file.
//
// argv[1] = BCP-47 locale for the preview (zh-CN | en-US), default zh-CN.
// `--file <16-bit mono wav>` replaces the microphone with a recording and
// skips the preview; it exists so the segmentation can be tested.
// `--no-preview` records from the microphone without asking macOS for
// speech recognition (diagnostics: that request aborts any process whose
// host app lacks NSSpeechRecognitionUsageDescription).

guard #available(macOS 10.15, *) else {
    fputs("error: macOS 10.15+ required\n", stderr)
    exit(1)
}

let argv = CommandLine.arguments
let fileIndex = argv.firstIndex(of: "--file")
let inputFile = fileIndex.flatMap { $0 + 1 < argv.count ? argv[$0 + 1] : nil }
let localeId = argv.count > 1 && !argv[1].hasPrefix("--") ? argv[1] : "zh-CN"
let wantPreview = inputFile == nil && !argv.contains("--no-preview")
let recognizer = wantPreview ? SFSpeechRecognizer(locale: Locale(identifier: localeId)) : nil

// Utterance segmentation (energy based).
let startMs = 60.0            // this much speech in a row opens an utterance
let endSilenceMs = 900.0      // this much quiet closes it
let minSpeechMs = 250.0       // shorter than this is a click / cough: dropped
let maxUtteranceMs = 60_000.0 // hard cut for someone who never pauses
let preRollMs = 300.0         // audio kept from just before speech was detected
let floorWindowMs = 8_000.0   // how far back the room-noise estimate looks
let speechMarginDb = 5.0      // speech = this far above the room noise

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
var inSpeech = false
var pendingStartMs = 0.0
var speechMs = 0.0
var silenceMs = 0.0
var preRoll: [Float] = []
var utterance: [Float] = []

func emit(_ line: String) {
    print(line)
    fflush(stdout)
}

func startPreview() {
    guard previewAllowed, let recognizer = recognizer, recognizer.isAvailable else { return }
    let req = SFSpeechAudioBufferRecognitionRequest()
    req.shouldReportPartialResults = true
    requestLock.lock(); request = req; requestLock.unlock()
    task = recognizer.recognitionTask(with: req) { result, _ in
        guard let result = result else { return }
        let text = result.bestTranscription.formattedString
        state.async {
            // A late callback from a preview we already replaced must not
            // leak into the next utterance.
            requestLock.lock(); let current = request === req; requestLock.unlock()
            guard current, text != lastTranscript else { return }
            lastTranscript = text
            emit("partial:\(text)")
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

func handOver() {
    guard speechMs >= minSpeechMs, let path = writeWav(utterance) else { emit("dropped:"); return }
    emit("audio:\(path)\t\(lastTranscript.replacingOccurrences(of: "\n", with: " "))")
}

func endUtterance() {
    handOver()
    inSpeech = false
    pendingStartMs = 0
    speechMs = 0
    silenceMs = 0
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
            emit("speaking:")
            inSpeech = true
            utterance = preRoll
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
    sampleRate = Double(data.subdata(in: 24..<28).withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }.littleEndian)
    let pcm = data.subdata(in: 44..<data.count).withUnsafeBytes { Array($0.bindMemory(to: Int16.self)) }
    var i = 0
    while i < pcm.count {
        let end = min(i + 1024, pcm.count)
        process(pcm[i..<end].map { Float(Int16(littleEndian: $0)) / 32768 })
        i = end
    }
    if inSpeech { handOver() }
    exit(0)
} else {
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

    // The preview is optional: without speech-recognition permission the
    // helper still records utterances for cloud transcription.
    if wantPreview {
        SFSpeechRecognizer.requestAuthorization { status in
            state.async {
                if status == .authorized {
                    previewAllowed = true
                    startPreview()
                } else {
                    fputs("note: live preview unavailable (speech recognition status \(status.rawValue))\n", stderr)
                }
            }
        }
    }

    // Stop: hand over whatever was being said, then exit.
    signal(SIGINT, SIG_IGN)
    signal(SIGTERM, SIG_IGN)
    var signalSources: [DispatchSourceSignal] = []
    for sig in [SIGINT, SIGTERM] {
        let src = DispatchSource.makeSignalSource(signal: sig, queue: state)
        src.setEventHandler {
            audioEngine.stop()
            inputNode.removeTap(onBus: 0)
            if inSpeech { handOver() }
            exit(0)
        }
        src.resume()
        signalSources.append(src)
    }

    RunLoop.main.run()
}
