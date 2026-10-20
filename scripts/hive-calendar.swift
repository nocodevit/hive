// hive-calendar: a day's Mac Calendar events as JSON lines (EventKit).
//
//   hive-calendar --request           ask for calendar access → {"access":"granted"|"denied"}
//   hive-calendar [--date YYYY-MM-DD] events of that local day (default today):
//       {"title":…,"start":<ms>,"end":<ms>,"allDay":bool,"location":…}
//   errors: {"error":"denied"|"bad_date"|…} and exit 1
//
// Build: swiftc -O scripts/hive-calendar.swift -o scripts/hive-calendar

import EventKit
import Foundation

let store = EKEventStore()

func emit(_ obj: [String: Any]) {
  if let data = try? JSONSerialization.data(withJSONObject: obj),
     let s = String(data: data, encoding: .utf8) {
    print(s)
  }
}

func fail(_ msg: String) -> Never {
  emit(["error": msg])
  exit(1)
}

func requestAccess() -> Bool {
  let sem = DispatchSemaphore(value: 0)
  var granted = false
  let done: (Bool, Error?) -> Void = { ok, _ in granted = ok; sem.signal() }
  if #available(macOS 14.0, *) {
    store.requestFullAccessToEvents(completion: done)
  } else {
    store.requestAccess(to: .event, completion: done)
  }
  _ = sem.wait(timeout: .now() + 120)
  return granted
}

func hasAccess() -> Bool {
  let status = EKEventStore.authorizationStatus(for: .event)
  if #available(macOS 14.0, *) {
    return status == .fullAccess
  }
  return status == .authorized
}

let args = CommandLine.arguments

if args.contains("--request") {
  emit(["access": (hasAccess() || requestAccess()) ? "granted" : "denied"])
  exit(0)
}

if !hasAccess() { fail("denied") }

var day = Calendar.current.startOfDay(for: Date())
if let i = args.firstIndex(of: "--date"), i + 1 < args.count {
  let f = DateFormatter()
  f.locale = Locale(identifier: "en_US_POSIX")
  f.timeZone = TimeZone.current
  f.dateFormat = "yyyy-MM-dd"
  guard let d = f.date(from: args[i + 1]) else { fail("bad_date") }
  day = Calendar.current.startOfDay(for: d)
}
guard let next = Calendar.current.date(byAdding: .day, value: 1, to: day) else { fail("bad_date") }

let predicate = store.predicateForEvents(withStart: day, end: next, calendars: nil)
let events = store.events(matching: predicate).sorted { $0.startDate < $1.startDate }
for e in events {
  if e.status == .canceled { continue }
  var obj: [String: Any] = [
    "title": e.title ?? "",
    "start": Int64(e.startDate.timeIntervalSince1970 * 1000),
    "end": Int64(e.endDate.timeIntervalSince1970 * 1000),
    "allDay": e.isAllDay
  ]
  if let loc = e.location, !loc.isEmpty { obj["location"] = loc }
  emit(obj)
}
