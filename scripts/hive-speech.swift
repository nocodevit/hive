#!/usr/bin/env swift

import Foundation
import Speech
import AVFoundation

// Real-time speech recognition using macOS SFSpeechRecognizer
// Outputs transcribed text to stdout, one line per utterance

guard #available(macOS 10.15, *) else {
    fputs("error: macOS 10.15+ required\n", stderr)
    exit(1)
}

let locale = Locale(identifier: "en-US")
guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
    fputs("error: speech recognizer not available\n", stderr)
    exit(1)
}

SFSpeechRecognizer.requestAuthorization { status in
    guard status == .authorized else {
        fputs("error: speech recognition not authorized (status: \(status.rawValue))\n", stderr)
        exit(1)
    }
}

let audioEngine = AVAudioEngine()
let request = SFSpeechAudioBufferRecognitionRequest()
request.shouldReportPartialResults = true

let inputNode = audioEngine.inputNode
let recordingFormat = inputNode.outputFormat(forBus: 0)

inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
    request.append(buffer)
}

audioEngine.prepare()
do {
    try audioEngine.start()
} catch {
    fputs("error: audio engine failed to start: \(error)\n", stderr)
    exit(1)
}

fputs("listening\n", stderr)

var lastTranscript = ""
var silenceTimer: Timer?

recognizer.recognitionTask(with: request) { result, error in
    if let result = result {
        let transcript = result.bestTranscription.formattedString
        if transcript != lastTranscript {
            lastTranscript = transcript
            // Print partial results prefixed with "partial:"
            print("partial:\(transcript)")
            fflush(stdout)
        }
        if result.isFinal {
            print("final:\(transcript)")
            fflush(stdout)
            lastTranscript = ""
        }
    }
    if let error = error {
        fputs("error: \(error.localizedDescription)\n", stderr)
    }
}

// Handle SIGINT/SIGTERM for clean shutdown
signal(SIGINT) { _ in
    audioEngine.stop()
    inputNode.removeTap(onBus: 0)
    request.endAudio()
    exit(0)
}
signal(SIGTERM) { _ in
    audioEngine.stop()
    inputNode.removeTap(onBus: 0)
    request.endAudio()
    exit(0)
}

// Keep running
RunLoop.main.run()
