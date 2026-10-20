export const TICKET_STATUSES = ["NEW", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]
export type AssignmentSource = "PLANNED" | "REPLACEMENT" | "FALLBACK"
export type TicketPolicy = "PER_SUBMISSION" | "PER_REASON"

const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  NEW: ["ASSIGNED", "CLOSED"],
  ASSIGNED: ["IN_PROGRESS", "CLOSED"],
  IN_PROGRESS: ["RESOLVED", "ASSIGNED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: [],
}

export function canTransition(from: TicketStatus, to: TicketStatus) {
  return TRANSITIONS[from].includes(to)
}

export function permissionForTransition(to: TicketStatus) {
  if (to === "CLOSED") return "tickets.close"
  if (to === "ASSIGNED") return "tickets.assign"
  return "tickets.update"
}

export type ReasonRule = {
  code: string
  active: boolean
  allowFreeText: boolean
  freeTextRequired: boolean
}

export function validateSurvey(input: {
  rating: number
  restroomCategory: string
  reasonCodes: string[]
  otherText?: string | null
  negativeMax: number
  reasons: ReasonRule[]
}): { ok: true } | { ok: false; message: string } {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return { ok: false, message: "Choose a rating from 1 to 5." }
  }
  if (input.restroomCategory !== "MALE" && input.restroomCategory !== "FEMALE") {
    return { ok: false, message: "Select the male or female restroom." }
  }
  const unique = [...new Set(input.reasonCodes)]
  if (unique.length !== input.reasonCodes.length) {
    return { ok: false, message: "Each dissatisfaction reason can be selected once." }
  }
  const catalog = new Map(input.reasons.filter((reason) => reason.active).map((reason) => [reason.code, reason]))
  for (const code of unique) {
    if (!catalog.has(code)) return { ok: false, message: "One of the selected reasons is not available." }
  }
  if (input.rating <= input.negativeMax) {
    if (unique.length === 0) {
      return { ok: false, message: "Select at least one reason for this rating." }
    }
  }
  for (const code of unique) {
    const reason = catalog.get(code)
    if (reason?.allowFreeText && reason.freeTextRequired && !input.otherText?.trim()) {
      return { ok: false, message: "Describe the other issue before submitting." }
    }
  }
  if (input.otherText && input.otherText.trim().length > 500) {
    return { ok: false, message: "Other details must be 500 characters or fewer." }
  }
  return { ok: true }
}

export function ticketPlan(policy: TicketPolicy, reasonCodes: string[]): string[][] {
  const unique = [...new Set(reasonCodes)]
  if (policy === "PER_REASON" && unique.length > 0) return unique.map((code) => [code])
  return [unique]
}

export type CoverageCandidate = {
  staffId: string
  source: "PLANNED" | "REPLACEMENT"
  absent: boolean
  active: boolean
}

export function chooseAssignee(candidates: CoverageCandidate[]): {
  staffId: string
  source: "PLANNED" | "REPLACEMENT"
} | null {
  const replacements = candidates.filter((candidate) => candidate.source === "REPLACEMENT")
  if (replacements.length > 0) {
    const available = replacements.find((candidate) => candidate.active && !candidate.absent)
    return available ? { staffId: available.staffId, source: "REPLACEMENT" } : null
  }
  const planned = candidates.find((candidate) => candidate.source === "PLANNED" && candidate.active && !candidate.absent)
  return planned ? { staffId: planned.staffId, source: "PLANNED" } : null
}

export type SlaClock = "RECEIVED_AT" | "EVENT_AT"

export type SlaConfigInput = {
  id: string
  responseMinutes: number | null
  progressMinutes: number | null
  resolutionMinutes: number | null
  graceMinutes: number
  priority: string | null
  locationId: string | null
  reasonId: string | null
  active: boolean
} | null

export type SlaState =
  | "NO_THRESHOLD"
  | "WITHIN"
  | "APPROACHING"
  | "OVERDUE"
  | "UNASSIGNED"
  | "WAITING_ACK"
  | "DELAYED_NOTIFICATION"
  | "DELAYED_SYNC"

export function slaAssessment(input: {
  now: Date
  eventAt: Date
  receivedAt: Date
  acknowledgedAt: Date | null
  firstProgressAt: Date | null
  resolvedAt: Date | null
  closedAt: Date | null
  status: TicketStatus
  hasAssignee: boolean
  clock: SlaClock
  config: SlaConfigInput
  delayedSyncMinutes: number
  notificationDelayed: boolean
}) {
  const start = input.clock === "EVENT_AT" ? input.eventAt : input.receivedAt
  const end = input.closedAt ?? input.resolvedAt ?? input.now
  const ageMinutes = Math.max(0, (end.getTime() - start.getTime()) / 60000)
  const responseMinutes = input.acknowledgedAt
    ? Math.max(0, (input.acknowledgedAt.getTime() - start.getTime()) / 60000)
    : null
  const progressMinutes = input.firstProgressAt
    ? Math.max(0, (input.firstProgressAt.getTime() - start.getTime()) / 60000)
    : null
  const resolutionMinutes = input.resolvedAt
    ? Math.max(0, (input.resolvedAt.getTime() - start.getTime()) / 60000)
    : null
  const driftMinutes = Math.abs(input.receivedAt.getTime() - input.eventAt.getTime()) / 60000
  const states: SlaState[] = []
  if (driftMinutes >= input.delayedSyncMinutes) states.push("DELAYED_SYNC")
  if (!input.hasAssignee && input.status !== "CLOSED" && input.status !== "RESOLVED") states.push("UNASSIGNED")
  if (input.notificationDelayed) states.push("DELAYED_NOTIFICATION")

  const open = input.status !== "CLOSED" && input.status !== "RESOLVED"
  if (!input.config || !input.config.active || input.config.responseMinutes == null) {
    states.push("NO_THRESHOLD")
    if (!input.acknowledgedAt && open) states.push("WAITING_ACK")
  } else {
    const limit = input.config.responseMinutes + input.config.graceMinutes
    if (!input.acknowledgedAt && open) {
      states.push("WAITING_ACK")
      if (ageMinutes > limit) states.push("OVERDUE")
      else if (ageMinutes >= limit * 0.75) states.push("APPROACHING")
      else states.push("WITHIN")
    } else if (responseMinutes != null && responseMinutes > limit) {
      states.push("OVERDUE")
    } else {
      states.push("WITHIN")
    }
    if (
      input.config.resolutionMinutes != null &&
      open &&
      !input.resolvedAt &&
      ageMinutes > input.config.resolutionMinutes + input.config.graceMinutes
    ) {
      if (!states.includes("OVERDUE")) states.push("OVERDUE")
    }
  }

  const priority: SlaState[] = [
    "UNASSIGNED",
    "OVERDUE",
    "DELAYED_SYNC",
    "APPROACHING",
    "WAITING_ACK",
    "DELAYED_NOTIFICATION",
    "WITHIN",
    "NO_THRESHOLD",
  ]
  const primary = priority.find((state) => states.includes(state)) ?? "NO_THRESHOLD"
  const overdueMinutes =
    states.includes("OVERDUE") && input.config?.responseMinutes != null
      ? Math.max(0, ageMinutes - (input.config.responseMinutes + input.config.graceMinutes))
      : null

  return {
    states,
    primary,
    responseMinutes,
    progressMinutes,
    resolutionMinutes,
    ageMinutes,
    overdueMinutes,
    clockStart: input.clock,
  }
}

export function pickSlaConfig<T extends { active: boolean; priority: string | null; locationId: string | null; reasonId: string | null }>(
  configs: T[],
  ticket: { priority: string; locationId: string; reasonIds: string[] },
) {
  const matches = configs.filter((config) => {
    if (!config.active) return false
    if (config.priority && config.priority !== ticket.priority) return false
    if (config.locationId && config.locationId !== ticket.locationId) return false
    if (config.reasonId && !ticket.reasonIds.includes(config.reasonId)) return false
    return true
  })
  matches.sort((a, b) => specificity(b) - specificity(a))
  return matches[0] ?? null
}

function specificity(config: { priority: string | null; locationId: string | null; reasonId: string | null }) {
  return (config.locationId ? 4 : 0) + (config.priority ? 2 : 0) + (config.reasonId ? 1 : 0)
}

export function notificationDedupeKey(eventType: string, ticketId: string, qualifier?: string) {
  return qualifier ? `${eventType}:${ticketId}:${qualifier}` : `${eventType}:${ticketId}`
}

export function shiftCovers(shift: { startMinute: number; endMinute: number }, minuteOfDay: number) {
  if (shift.startMinute === shift.endMinute) return true
  if (shift.startMinute < shift.endMinute) {
    return minuteOfDay >= shift.startMinute && minuteOfDay < shift.endMinute
  }
  return minuteOfDay >= shift.startMinute || minuteOfDay < shift.endMinute
}

export function shiftsOverlap(
  a: { startMinute: number; endMinute: number },
  b: { startMinute: number; endMinute: number },
) {
  const left = expandShift(a)
  const right = expandShift(b)
  return left.some((one) => right.some((two) => one.start < two.end && two.start < one.end))
}

function expandShift(shift: { startMinute: number; endMinute: number }) {
  if (shift.startMinute < shift.endMinute) return [{ start: shift.startMinute, end: shift.endMinute }]
  if (shift.startMinute === shift.endMinute) return [{ start: 0, end: 1440 }]
  return [
    { start: shift.startMinute, end: 1440 },
    { start: 0, end: shift.endMinute },
  ]
}

export function isSuspiciousDrift(driftMs: number, thresholdMinutes: number) {
  return Math.abs(driftMs) >= thresholdMinutes * 60000
}

export function maskPhone(phone: string | null | undefined, canView: boolean) {
  if (!phone) return null
  if (canView) return phone
  const digits = phone.replace(/\D/g, "")
  return `•••${digits.slice(-4)}`
}

export function deriveDeviceStatus(input: {
  active: boolean
  lastSeenAt: Date | null
  lastSyncError: string | null
  pendingOfflineCount: number
  staleAfterSec: number
  now: Date
}) {
  if (!input.active) return "INACTIVE" as const
  const stale =
    !input.lastSeenAt || input.now.getTime() - input.lastSeenAt.getTime() > input.staleAfterSec * 1000
  if (stale) return "OFFLINE" as const
  if (input.lastSyncError) return "ERROR" as const
  if (input.pendingOfflineCount > 0) return "SYNC_PENDING" as const
  return "ONLINE" as const
}

export const CHECK_IN_MEANING =
  "Check-in confirms presence only. It does not show that cleaning was completed or that the restroom is clean."
