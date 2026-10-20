import { describe, expect, it } from "vitest"
import {
  canTransition,
  chooseAssignee,
  deriveDeviceStatus,
  notificationDedupeKey,
  shiftCovers,
  shiftsOverlap,
  slaAssessment,
  ticketPlan,
  validateSurvey,
} from "./domain"

const reasons = [
  { code: "ODOR", active: true, allowFreeText: false, freeTextRequired: false },
  { code: "OTHER", active: true, allowFreeText: true, freeTextRequired: false },
]

describe("survey rules", () => {
  it("requires a restroom category and a rating", () => {
    expect(validateSurvey({ rating: 3, restroomCategory: "OTHER", reasonCodes: ["ODOR"], negativeMax: 3, reasons }).ok).toBe(false)
  })

  it("requires one or more reasons for ratings 1 to 3", () => {
    expect(validateSurvey({ rating: 2, restroomCategory: "MALE", reasonCodes: [], negativeMax: 3, reasons }).ok).toBe(false)
    expect(validateSurvey({ rating: 2, restroomCategory: "FEMALE", reasonCodes: ["ODOR", "OTHER"], negativeMax: 3, reasons }).ok).toBe(true)
  })

  it("submits ratings 4 and 5 without reasons", () => {
    expect(validateSurvey({ rating: 5, restroomCategory: "MALE", reasonCodes: [], negativeMax: 3, reasons }).ok).toBe(true)
  })

  it("does not require other text unless configured", () => {
    const strict = [{ ...reasons[1], freeTextRequired: true }]
    expect(validateSurvey({ rating: 1, restroomCategory: "MALE", reasonCodes: ["OTHER"], negativeMax: 3, reasons: strict }).ok).toBe(false)
    expect(validateSurvey({ rating: 1, restroomCategory: "MALE", reasonCodes: ["OTHER"], otherText: "Door lock", negativeMax: 3, reasons: strict }).ok).toBe(true)
  })
})

describe("complaint routing and tickets", () => {
  it("uses the active replacement instead of the planned staff member", () => {
    const chosen = chooseAssignee([
      { staffId: "planned", source: "PLANNED", absent: false, active: true },
      { staffId: "cover", source: "REPLACEMENT", absent: false, active: true },
    ])
    expect(chosen).toEqual({ staffId: "cover", source: "REPLACEMENT" })
  })

  it("does not fall back to the planned person when the replacement is unavailable", () => {
    expect(
      chooseAssignee([
        { staffId: "planned", source: "PLANNED", absent: false, active: true },
        { staffId: "cover", source: "REPLACEMENT", absent: true, active: true },
      ]),
    ).toBeNull()
  })

  it("keeps one ticket per submission by default and can split by reason", () => {
    expect(ticketPlan("PER_SUBMISSION", ["ODOR", "FLOOR"])).toEqual([["ODOR", "FLOOR"]])
    expect(ticketPlan("PER_REASON", ["ODOR", "FLOOR"])).toEqual([["ODOR"], ["FLOOR"]])
  })

  it("rejects a resolution that skips acknowledgement", () => {
    expect(canTransition("ASSIGNED", "RESOLVED")).toBe(false)
    expect(canTransition("ASSIGNED", "IN_PROGRESS")).toBe(true)
    expect(canTransition("IN_PROGRESS", "RESOLVED")).toBe(true)
    expect(canTransition("RESOLVED", "CLOSED")).toBe(true)
    expect(canTransition("CLOSED", "IN_PROGRESS")).toBe(false)
  })

  it("uses one notification key for the same complaint event", () => {
    expect(notificationDedupeKey("complaint.created", "ticket-1")).toBe(notificationDedupeKey("complaint.created", "ticket-1"))
    expect(notificationDedupeKey("complaint.assigned", "ticket-1", "history-2")).not.toBe(notificationDedupeKey("complaint.created", "ticket-1"))
  })
})

describe("SLA and presence", () => {
  const base = {
    now: new Date("2026-10-20T02:00:00Z"),
    eventAt: new Date("2026-10-20T01:00:00Z"),
    receivedAt: new Date("2026-10-20T01:10:00Z"),
    acknowledgedAt: null,
    firstProgressAt: null,
    resolvedAt: null,
    closedAt: null,
    status: "ASSIGNED" as const,
    hasAssignee: true,
    clock: "RECEIVED_AT" as const,
    delayedSyncMinutes: 10,
    notificationDelayed: false,
  }

  it("does not mark a ticket overdue when no threshold is active", () => {
    const result = slaAssessment({ ...base, config: null })
    expect(result.states).toContain("NO_THRESHOLD")
    expect(result.states).not.toContain("OVERDUE")
  })

  it("keeps response and resolution clocks separate", () => {
    const result = slaAssessment({
      ...base,
      acknowledgedAt: new Date("2026-10-20T01:25:00Z"),
      firstProgressAt: new Date("2026-10-20T01:40:00Z"),
      resolvedAt: new Date("2026-10-20T02:00:00Z"),
      status: "RESOLVED",
      config: {
        id: "cfg",
        responseMinutes: 20,
        progressMinutes: null,
        resolutionMinutes: null,
        graceMinutes: 0,
        priority: null,
        locationId: null,
        reasonId: null,
        active: true,
      },
    })
    expect(result.responseMinutes).toBe(15)
    expect(result.progressMinutes).toBe(30)
    expect(result.resolutionMinutes).toBe(50)
  })

  it("flags delayed synchronization without using it as the response start", () => {
    const result = slaAssessment({ ...base, config: null })
    expect(result.states).toContain("DELAYED_SYNC")
    expect(result.clockStart).toBe("RECEIVED_AT")
  })

  it("detects overlapping shifts but allows a shift that covers the current minute", () => {
    expect(shiftsOverlap({ startMinute: 360, endMinute: 840 }, { startMinute: 800, endMinute: 1200 })).toBe(true)
    expect(shiftCovers({ startMinute: 360, endMinute: 840 }, 400)).toBe(true)
    expect(shiftCovers({ startMinute: 1320, endMinute: 360 }, 100)).toBe(true)
  })

  it("describes device health from heartbeat evidence", () => {
    const now = new Date("2026-10-20T02:00:00Z")
    expect(deriveDeviceStatus({ active: true, lastSeenAt: now, lastSyncError: null, pendingOfflineCount: 0, staleAfterSec: 180, now })).toBe("ONLINE")
    expect(deriveDeviceStatus({ active: true, lastSeenAt: now, lastSyncError: null, pendingOfflineCount: 2, staleAfterSec: 180, now })).toBe("SYNC_PENDING")
    expect(deriveDeviceStatus({ active: true, lastSeenAt: new Date("2026-10-20T00:00:00Z"), lastSyncError: null, pendingOfflineCount: 0, staleAfterSec: 180, now })).toBe("OFFLINE")
    expect(deriveDeviceStatus({ active: false, lastSeenAt: now, lastSyncError: null, pendingOfflineCount: 0, staleAfterSec: 180, now })).toBe("INACTIVE")
  })
})
