import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import type { Actor } from "@/lib/permissions"
import { accessibleLocationFilter } from "@/lib/scope"
import { addDays, localDateString, span } from "@/lib/time"
import { deriveDeviceStatus, pickSlaConfig, slaAssessment } from "@/server/domain"
import { getSettings } from "@/server/settings"

export type DashboardFilters = {
  from?: string
  to?: string
  buildingId?: string
  locationId?: string
  category?: "MALE" | "FEMALE"
  deviceId?: string
  status?: string
  reasonId?: string
  staffId?: string
}

export async function dashboard(actor: Actor, filters: DashboardFilters) {
  const settings = await getSettings()
  const timeZone = settings["app.timezone"]
  const today = localDateString(new Date(), timeZone)
  const from = filters.from || addDays(today, -13)
  const to = filters.to || today
  const range = span(from, to, timeZone)
  const negativeMax = Number(settings["survey.negativeMaxRating"])
  const location = await accessibleLocationFilter(actor)
  const feedbackWhere: Prisma.FeedbackSubmissionWhereInput = {
    AND: [
      { receivedAt: { gte: range.start, lt: range.end } },
      { location },
      filters.locationId ? { locationId: filters.locationId } : {},
      filters.buildingId ? { location: { floor: { buildingId: filters.buildingId } } } : {},
      filters.category ? { restroomCategory: filters.category } : {},
      filters.deviceId ? { deviceId: filters.deviceId } : {},
      filters.reasonId ? { reasons: { some: { reasonId: filters.reasonId } } } : {},
      filters.staffId
        ? { ticketLinks: { some: { ticket: { assignedStaffId: filters.staffId } } } }
        : {},
    ],
  }
  const ticketWhere: Prisma.ComplaintTicketWhereInput = {
    AND: [
      { receivedAt: { gte: range.start, lt: range.end } },
      { location },
      filters.locationId ? { locationId: filters.locationId } : {},
      filters.buildingId ? { location: { floor: { buildingId: filters.buildingId } } } : {},
      filters.category ? { restroomCategory: filters.category } : {},
      filters.status ? { status: filters.status as Prisma.ComplaintTicketWhereInput["status"] } : {},
      filters.reasonId ? { reasons: { some: { reasonId: filters.reasonId } } } : {},
      filters.staffId ? { assignedStaffId: filters.staffId } : {},
    ],
  }
  const openWhere: Prisma.ComplaintTicketWhereInput = {
    AND: [ticketWhere, { status: { in: ["NEW", "ASSIGNED", "IN_PROGRESS"] } }],
  }
  const [feedbackCount, ratingAvg, ratingGroups, negativeCount, openCount, newCount, progressCount, tickets, reasons, devices, locations] =
    await Promise.all([
      prisma.feedbackSubmission.count({ where: feedbackWhere }),
      prisma.feedbackSubmission.aggregate({ where: feedbackWhere, _avg: { rating: true } }),
      prisma.feedbackSubmission.groupBy({ by: ["rating"], where: feedbackWhere, _count: true }),
      prisma.feedbackSubmission.count({ where: { AND: [feedbackWhere, { rating: { lte: negativeMax } }] } }),
      prisma.complaintTicket.count({ where: openWhere }),
      prisma.complaintTicket.count({ where: { AND: [ticketWhere, { status: "NEW" }] } }),
      prisma.complaintTicket.count({ where: { AND: [ticketWhere, { status: "IN_PROGRESS" }] } }),
      prisma.complaintTicket.findMany({
        where: ticketWhere,
        select: {
          status: true,
          receivedAt: true,
          eventAt: true,
          acknowledgedAt: true,
          resolvedAt: true,
          locationId: true,
          restroomCategory: true,
          assignedStaffId: true,
          fallbackUserId: true,
        },
      }),
      prisma.feedbackSubmissionReason.groupBy({
        by: ["reasonId"],
        where: { submission: feedbackWhere },
        _count: true,
        orderBy: { _count: { reasonId: "desc" } },
        take: 8,
      }),
      prisma.device.findMany({ where: { location }, include: { location: true } }),
      prisma.restroomLocation.findMany({ where: { AND: [location, { active: true }] }, select: { id: true, name: true } }),
    ])
  const reasonCatalog = await prisma.feedbackReason.findMany({ where: { id: { in: reasons.map((item) => item.reasonId) } } })
  const reasonName = new Map(reasonCatalog.map((reason) => [reason.id, reason.label]))
  const acknowledged = tickets.filter((ticket) => ticket.acknowledgedAt)
  const resolved = tickets.filter((ticket) => ticket.resolvedAt)
  const avg = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null)
  const response = avg(acknowledged.map((ticket) => (ticket.acknowledgedAt!.getTime() - ticket.receivedAt.getTime()) / 60000))
  const resolution = avg(resolved.map((ticket) => (ticket.resolvedAt!.getTime() - ticket.receivedAt.getTime()) / 60000))
  const now = new Date()
  const deviceItems = devices.map((device) =>
    deriveDeviceStatus({
      active: device.active,
      lastSeenAt: device.lastSeenAt,
      lastSyncError: device.lastSyncError,
      pendingOfflineCount: device.pendingOfflineCount,
      staleAfterSec: device.staleAfterSec,
      now,
    }),
  )
  const activeConfigs = await prisma.slaConfiguration.findMany({ where: { active: true } })
  let overdue = 0
  if (activeConfigs.length) {
    const openTickets = await prisma.complaintTicket.findMany({
      where: openWhere,
      include: { reasons: { select: { reasonId: true } } },
    })
    overdue = openTickets.filter((ticket) => {
      const config = pickSlaConfig(activeConfigs, {
        priority: ticket.priority,
        locationId: ticket.locationId,
        reasonIds: ticket.reasons.map((item) => item.reasonId),
      })
      return slaAssessment({
        now,
        eventAt: ticket.eventAt,
        receivedAt: ticket.receivedAt,
        acknowledgedAt: ticket.acknowledgedAt,
        firstProgressAt: ticket.firstProgressAt,
        resolvedAt: ticket.resolvedAt,
        closedAt: ticket.closedAt,
        status: ticket.status,
        hasAssignee: Boolean(ticket.assignedStaffId || ticket.fallbackUserId),
        clock: settings["sla.clock"],
        config: config
          ? {
              id: config.id,
              responseMinutes: config.responseMinutes,
              progressMinutes: config.progressMinutes,
              resolutionMinutes: config.resolutionMinutes,
              graceMinutes: config.graceMinutes,
              priority: config.priority,
              locationId: config.locationId,
              reasonId: config.reasonId,
              active: config.active,
            }
          : null,
        delayedSyncMinutes: Number(settings["sla.delayedSyncMinutes"]),
        notificationDelayed: false,
      }).states.includes("OVERDUE")
    }).length
  }
  const dayMap = new Map<string, { count: number; rating: number }>()
  const feedbackRows = await prisma.feedbackSubmission.findMany({
    where: feedbackWhere,
    select: { receivedAt: true, rating: true, restroomCategory: true, locationId: true },
  })
  for (const row of feedbackRows) {
    const day = localDateString(row.receivedAt, timeZone)
    const current = dayMap.get(day) ?? { count: 0, rating: 0 }
    current.count += 1
    current.rating += row.rating
    dayMap.set(day, current)
  }
  const hourMap = new Map<number, number>()
  for (const row of feedbackRows) {
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(row.receivedAt).slice(0, 2),
    )
    hourMap.set(hour === 24 ? 0 : hour, (hourMap.get(hour === 24 ? 0 : hour) ?? 0) + 1)
  }
  const byLocation = new Map<string, number>()
  for (const ticket of tickets) byLocation.set(ticket.locationId, (byLocation.get(ticket.locationId) ?? 0) + 1)
  const locationName = new Map(locations.map((location) => [location.id, location.name]))
  const byStatus = new Map<string, number>()
  for (const ticket of tickets) byStatus.set(ticket.status, (byStatus.get(ticket.status) ?? 0) + 1)
  const todayAssignments = await prisma.plannedAssignment.findMany({
    where: { workDate: new Date(`${today}T00:00:00.000Z`), location },
    select: { locationId: true },
  })
  const covered = new Set(todayAssignments.map((item) => item.locationId))
  return {
    timeZone,
    from,
    to,
    dataLabel: settings["app.dataLabel"],
    definitions: {
      positive: "Ratings 4 and 5.",
      negative: `Ratings 1 to ${negativeMax}.`,
      response: "First acknowledgement minus server receipt time. This clock is provisional.",
      resolution: "Resolution time minus server receipt time. Closure is tracked separately.",
      visitors: "Feedback volume is not a visitor or footfall count.",
      sla: activeConfigs.length
        ? "An active SLA configuration exists. Treat it as provisional unless that record is marked approved."
        : "No approved response threshold is active. Overdue counts stay at zero until a threshold is enabled.",
    },
    kpis: {
      feedback: feedbackCount,
      averageRating: ratingAvg._avg.rating,
      positive: feedbackCount - negativeCount,
      negative: negativeCount,
      openComplaints: openCount,
      newTickets: newCount,
      inProgress: progressCount,
      overdue,
      overdueIsLiveThreshold: activeConfigs.length > 0,
      averageResponseMinutes: response,
      averageResolutionMinutes: resolution,
      coverageLocations: locations.length,
      coveredLocations: locations.filter((item) => covered.has(item.id)).length,
      devicesOnline: deviceItems.filter((status) => status === "ONLINE" || status === "SYNC_PENDING").length,
      devicesOffline: deviceItems.filter((status) => status === "OFFLINE" || status === "ERROR" || status === "INACTIVE").length,
    },
    ratings: [1, 2, 3, 4, 5].map((rating) => ({
      rating: String(rating),
      count: ratingGroups.find((item) => item.rating === rating)?._count ?? 0,
    })),
    trend: [...dayMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, value]) => ({ day, count: value.count, average: value.count ? value.rating / value.count : 0 })),
    reasons: reasons.map((item) => ({ label: reasonName.get(item.reasonId) ?? "Reason", count: item._count })),
    byLocation: [...byLocation.entries()].map(([id, count]) => ({ label: locationName.get(id) ?? "Location", count })),
    byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })),
    byHour: Array.from({ length: 24 }, (_, hour) => ({ hour: String(hour).padStart(2, "0"), count: hourMap.get(hour) ?? 0 })),
    todayCoverageNote: `Planned coverage for ${today} uses the local operations date. It is not proof of cleaning.`,
    rangeNote: `Figures use server receipt time from ${from} through ${to}, ${timeZone}.`,
  }
}
