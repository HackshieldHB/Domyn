import ExcelJS from "exceljs"
import { prisma } from "@/lib/db"
import { AppError } from "@/lib/errors"
import type { Actor } from "@/lib/permissions"
import { accessibleLocationFilter } from "@/lib/scope"
import { addDays, formatStamp, localDateString, span } from "@/lib/time"
import { getSettings } from "@/server/settings"

const REPORTS = [
  ["feedback", "Satisfaction feedback"],
  ["ratings", "Rating distribution"],
  ["reasons", "Dissatisfaction reasons"],
  ["complaints", "Complaint register"],
  ["lifecycle", "Ticket lifecycle"],
  ["performance", "Response and resolution"],
  ["overdue", "Overdue and escalated"],
  ["schedules", "Staff schedules"],
  ["absences", "Absences and replacements"],
  ["checkins", "Check-in history"],
  ["devices", "Device health"],
  ["notifications", "Notification delivery"],
] as const

export type ReportType = (typeof REPORTS)[number][0]

export function reportCatalog() {
  return REPORTS.map(([id, name]) => ({ id, name }))
}

export async function exportReport(actor: Actor, type: ReportType, filters: { from?: string; to?: string; locationId?: string }) {
  if (!actor.permissions.includes("reports.export")) throw new AppError(403, "FORBIDDEN", "You do not have access to this export.")
  if (!REPORTS.some(([id]) => id === type)) throw new AppError(400, "VALIDATION", "Unknown report.")
  const settings = await getSettings()
  const timeZone = settings["app.timezone"]
  const today = localDateString(new Date(), timeZone)
  const from = filters.from || addDays(today, -29)
  const to = filters.to || today
  const range = span(from, to, timeZone)
  const location = await accessibleLocationFilter(actor)
  const locationAnd = filters.locationId ? { id: filters.locationId } : {}
  const rows = await rowsFor(type, { start: range.start, end: range.end, location: { AND: [location, locationAnd] }, timeZone, from, to })
  if (rows.length > 10000) {
    throw new AppError(400, "VALIDATION", "This export matches more than 10,000 rows. Narrow the date range or location.")
  }
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "DOMYN"
  const sheet = workbook.addWorksheet(REPORTS.find(([id]) => id === type)?.[1] ?? "Report")
  sheet.addRow([`DOMYN export`, `Timezone ${timeZone}`, `${from} to ${to}`, "Times are converted from UTC for display."])
  sheet.addRow([])
  if (rows.length === 0) {
    sheet.addRow(["No records matched these filters."])
  } else {
    const headers = Object.keys(rows[0])
    sheet.addRow(headers)
    for (const row of rows) sheet.addRow(headers.map((header) => row[header] ?? ""))
    sheet.getRow(3).font = { bold: true }
  }
  sheet.columns.forEach((column) => {
    column.width = 24
  })
  const buffer = await workbook.xlsx.writeBuffer()
  return { buffer: Buffer.from(buffer), filename: `domyn-${type}-${from}-to-${to}.xlsx` }
}

async function rowsFor(
  type: ReportType,
  scope: { start: Date; end: Date; location: object; timeZone: string; from: string; to: string },
): Promise<Array<Record<string, string | number | null>>> {
  const stamp = (value: Date | null) => (value ? formatStamp(value, scope.timeZone) : "")
  if (type === "feedback" || type === "ratings" || type === "reasons") {
    const submissions = await prisma.feedbackSubmission.findMany({
      where: { receivedAt: { gte: scope.start, lt: scope.end }, location: scope.location },
      include: { location: { include: { floor: { include: { building: true } } } }, device: true, reasons: { include: { reason: true } } },
      orderBy: { receivedAt: "asc" },
      take: 10001,
    })
    if (type === "ratings") {
      return [1, 2, 3, 4, 5].map((rating) => ({
        rating,
        count: submissions.filter((item) => item.rating === rating).length,
      }))
    }
    if (type === "reasons") {
      const counts = new Map<string, number>()
      for (const submission of submissions) {
        for (const reason of submission.reasons) counts.set(reason.reason.label, (counts.get(reason.reason.label) ?? 0) + 1)
      }
      return [...counts.entries()].map(([reason, count]) => ({ reason, count }))
    }
    return submissions.map((item) => ({
      submissionId: item.id,
      clientSubmissionId: item.clientSubmissionId,
      building: item.location.floor.building.name,
      location: item.location.name,
      category: item.restroomCategory,
      rating: item.rating,
      reasons: item.reasons.map((reason) => reason.reason.label).join("; "),
      other: item.otherText,
      eventTime: stamp(item.eventAt),
      receivedTime: stamp(item.receivedAt),
      device: item.device.code,
      syncStatus: item.syncStatus,
    }))
  }
  if (type === "schedules") {
    const rows = await prisma.plannedAssignment.findMany({
      where: { workDate: { gte: new Date(`${scope.from}T00:00:00.000Z`), lte: new Date(`${scope.to}T00:00:00.000Z`) }, location: scope.location },
      include: { staff: true, location: true, shift: true },
      take: 10001,
    })
    return rows.map((item) => ({
      date: item.workDate.toISOString().slice(0, 10),
      staff: item.staff.name,
      employeeCode: item.staff.employeeCode,
      location: item.location.name,
      shift: item.shift.name,
      notes: item.notes,
    }))
  }
  if (type === "absences") {
    const absences = await prisma.staffAbsence.findMany({
      where: { startAt: { lt: scope.end }, endAt: { gt: scope.start } },
      include: { staff: true, replacements: { include: { replacementStaff: true, location: true } } },
      take: 10001,
    })
    return absences.flatMap((item) =>
      item.replacements.length
        ? item.replacements.map((replacement) => ({
            staff: item.staff.name,
            type: item.type,
            start: stamp(item.startAt),
            end: stamp(item.endAt),
            replacement: replacement.replacementStaff.name,
            location: replacement.location.name,
            reason: replacement.reason,
          }))
        : [{ staff: item.staff.name, type: item.type, start: stamp(item.startAt), end: stamp(item.endAt), replacement: "", location: "", reason: item.notes }],
    )
  }
  if (type === "checkins") {
    const rows = await prisma.staffCheckIn.findMany({
      where: { checkedInAt: { gte: scope.start, lt: scope.end }, location: scope.location },
      include: { staff: true, location: true },
      take: 10001,
    })
    return rows.map((item) => ({
      staff: item.staff.name,
      location: item.location.name,
      method: item.method,
      checkedIn: stamp(item.checkedInAt),
      matchesAssignment: item.matchesAssignment ? "Yes" : "No",
      meaning: "Presence only. Not proof of cleaning.",
      correction: item.correctionReason,
    }))
  }
  if (type === "devices") {
    const rows = await prisma.device.findMany({ where: { location: scope.location }, include: { location: true }, take: 10001 })
    return rows.map((item) => ({
      code: item.code,
      name: item.name,
      location: item.location.name,
      connection: item.connectionType,
      status: item.status,
      lastSeen: stamp(item.lastSeenAt),
      lastSync: stamp(item.lastSyncAt),
      pending: item.pendingOfflineCount,
      lastError: item.lastSyncError,
      clockDriftMs: item.clockDriftMs,
    }))
  }
  if (type === "notifications") {
    const rows = await prisma.notification.findMany({
      where: { createdAt: { gte: scope.start, lt: scope.end }, ticket: { location: scope.location } },
      include: { ticket: true, attempts: true },
      take: 10001,
    })
    return rows.map((item) => ({
      event: item.eventType,
      ticket: item.ticket?.reference ?? "",
      status: item.status,
      mode: item.mode,
      simulated: item.mode === "SANDBOX" ? "Yes — not sent to WhatsApp" : "No",
      attempts: item.attempts.length,
      created: stamp(item.createdAt),
    }))
  }
  const tickets = await prisma.complaintTicket.findMany({
    where: { receivedAt: { gte: scope.start, lt: scope.end }, location: scope.location },
    include: { location: { include: { floor: { include: { building: true } } } }, assignedStaff: true, reasons: { include: { reason: true } }, slaEvents: true, statusHistory: true },
    take: 10001,
  })
  const selected =
    type === "overdue"
      ? tickets.filter((ticket) => ticket.slaEvents.length > 0 || (!ticket.acknowledgedAt && ticket.status !== "CLOSED" && ticket.status !== "RESOLVED"))
      : tickets
  if (type === "performance") {
    return selected.map((ticket) => ({
      reference: ticket.reference,
      responseMinutes: ticket.acknowledgedAt ? Math.round((ticket.acknowledgedAt.getTime() - ticket.receivedAt.getTime()) / 60000) : null,
      progressMinutes: ticket.firstProgressAt ? Math.round((ticket.firstProgressAt.getTime() - ticket.receivedAt.getTime()) / 60000) : null,
      resolutionMinutes: ticket.resolvedAt ? Math.round((ticket.resolvedAt.getTime() - ticket.receivedAt.getTime()) / 60000) : null,
      acknowledged: stamp(ticket.acknowledgedAt),
      resolved: stamp(ticket.resolvedAt),
      closed: stamp(ticket.closedAt),
    }))
  }
  if (type === "lifecycle") {
    return selected.map((ticket) => ({
      reference: ticket.reference,
      status: ticket.status,
      transitions: ticket.statusHistory.map((item) => `${item.fromStatus ?? "—"}→${item.toStatus}`).join(", "),
      eventTime: stamp(ticket.eventAt),
      receivedTime: stamp(ticket.receivedAt),
      acknowledged: stamp(ticket.acknowledgedAt),
      progress: stamp(ticket.firstProgressAt),
      resolved: stamp(ticket.resolvedAt),
      closed: stamp(ticket.closedAt),
    }))
  }
  return selected.map((ticket) => ({
    reference: ticket.reference,
    status: ticket.status,
    building: ticket.location.floor.building.name,
    location: ticket.location.name,
    category: ticket.restroomCategory,
    rating: ticket.rating,
    reasons: ticket.reasons.map((reason) => reason.reason.label).join("; "),
    assignee: ticket.assignedStaff?.name ?? "",
    eventTime: stamp(ticket.eventAt),
    receivedTime: stamp(ticket.receivedAt),
    escalations: ticket.slaEvents.length,
  }))
}
