import { createHash, randomBytes } from "node:crypto"

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url")
}

export function zonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]))
  let hour = Number(parts.hour)
  if (hour === 24) hour = 0
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
  }
}

export function localDateString(date: Date, timeZone: string) {
  const parts = zonedParts(date, timeZone)
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
}

export function localMinutes(date: Date, timeZone: string) {
  const parts = zonedParts(date, timeZone)
  return parts.hour * 60 + parts.minute
}

export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
) {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0)
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(new Date(utc), timeZone)
    const got = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0)
    const want = Date.UTC(year, month - 1, day, hour, minute, 0)
    const diff = want - got
    if (diff === 0) break
    utc += diff
  }
  return new Date(utc)
}

export function localDayRange(dateStr: string, timeZone: string) {
  const [year, month, day] = dateStr.split("-").map(Number)
  const start = zonedTimeToUtc(year, month, day, 0, 0, timeZone)
  const next = new Date(Date.UTC(year, month - 1, day) + 24 * 60 * 60 * 1000)
  const end = zonedTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, timeZone)
  return { start, end }
}

export function workDate(dateStr: string) {
  const [year, month, day] = dateStr.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

export function formatStamp(value: string | Date | null | undefined, timeZone: string) {
  if (!value) return "—"
  const date = typeof value === "string" ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function formatDate(value: string | Date | null | undefined, timeZone = "UTC") {
  if (!value) return "—"
  const date = typeof value === "string" ? new Date(value) : value
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(date)
}

export function formatMinutes(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—"
  if (value < 1) return "<1 min"
  const rounded = Math.round(value)
  if (rounded < 60) return `${rounded} min`
  const hours = Math.floor(rounded / 60)
  const minutes = rounded % 60
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`
}

function pad(value: number) {
  return String(value).padStart(2, "0")
}

export function addDays(dateStr: string, days: number) {
  const [year, month, day] = dateStr.split("-").map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`
}

export function span(from: string, to: string, timeZone: string) {
  const start = localDayRange(from, timeZone).start
  const end = localDayRange(to, timeZone).end
  return { start, end }
}

export function eachDate(from: string, to: string) {
  const dates: string[] = []
  let cursor = from
  while (cursor <= to) {
    dates.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return dates
}
