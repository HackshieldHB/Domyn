import { Prisma, TicketPriority, TicketStatus } from "@prisma/client"
import { prisma } from "@/lib/db"
import { writeAudit } from "@/lib/audit"
import { AppError } from "@/lib/errors"
import { hasPermission, type Actor } from "@/lib/permissions"
import { assertTicketAccess, accessibleLocationFilter } from "@/lib/scope"
import { addDays, localDateString, span } from "@/lib/time"
import { canTransition, permissionForTransition, pickSlaConfig, slaAssessment, ticketPlan, type TicketPolicy } from "@/server/domain"
import { dispatchMany, queueNotification, ticketLink, type NoticePayload } from "@/server/notifications"
import { routeLocation } from "@/server/routing"
import { getSettings, type SettingValues } from "@/server/settings"

const ticketInclude = {
  location: { include: { floor: { include: { building: true } }, supervisor: true } },
  assignedStaff: true,
  fallbackUser: true,
  reasons: { include: { reason: true } },
  feedbackLinks: { include: { submission: { include: { reasons: { include: { reason: true } }, device: true } } } },
  notifications: { select: { status: true, createdAt: true, mode: true } },
} satisfies Prisma.ComplaintTicketInclude

export async function createTicketsForSubmission(
  tx: Prisma.TransactionClient,
  input: {
    submissionId: string
    locationId: string
    deviceCode: string
    restroomCategory: "MALE" | "FEMALE"
    rating: number
    reasonCodes: string[]
    eventAt: Date
    receivedAt: Date
    settings: SettingValues
  },
) {
  const negativeMax = Number(input.settings["survey.negativeMaxRating"])
  if (input.rating > negativeMax) return []
  const policy = input.settings["ticket.policy"] as TicketPolicy
  const reasonRows = await tx.feedbackReason.findMany({ where: { code: { in: input.reasonCodes } } })
  const byCode = new Map(reasonRows.map((reason) => [reason.code, reason]))
  const plans = ticketPlan(policy, input.reasonCodes)
  const routing = await routeLocation(tx, input.locationId, input.receivedAt, input.settings["app.timezone"])
  const ids: string[] = []
  for (const codes of plans) {
    const reasons = codes.map((code) => byCode.get(code)).filter((reason) => reason != null)
    const reference = await nextReference(tx, input.receivedAt)
    const status: TicketStatus = routing.staffId || routing.fallbackUserId ? "ASSIGNED" : "NEW"
    const groupId = await groupFor(tx, input, reasons[0]?.id ?? null)
    const ticket = await tx.complaintTicket.create({
      data: {
        reference,
        locationId: input.locationId,
        restroomCategory: input.restroomCategory,
        rating: input.rating,
        status,
        priority: input.rating === 1 ? "HIGH" : "NORMAL",
        assignedStaffId: routing.staffId,
        fallbackUserId: routing.staffId ? null : routing.fallbackUserId,
        assignmentSource: routing.staffId || routing.fallbackUserId ? routing.source : null,
        fallbackReason: routing.fallbackReason,
        eventAt: input.eventAt,
        receivedAt: input.receivedAt,
        groupId,
        policy,
        reasons: { create: reasons.map((reason) => ({ reasonId: reason.id })) },
        feedbackLinks: { create: [{ submissionId: input.submissionId }] },
        statusHistory: { create: [{ toStatus: status, note: "Opened from satisfaction feedback." }] },
        assignmentHistory: {
          create: [
            {
              toStaffId: routing.staffId,
              source: routing.source,
              reason: routing.fallbackReason,
            },
          ],
        },
        events: {
          create: [
            {
              type: "routed",
              message: routing.staffId
                ? `Routed to active ${routing.source.toLowerCase()} assignment.`
                : routing.fallbackReason || "No assignee was available.",
              data: { source: routing.source, staffId: routing.staffId, fallbackUserId: routing.fallbackUserId },
            },
          ],
        },
      },
      include: ticketInclude,
    })
    const notificationId = await queueNotification(tx, {
      ticketId: ticket.id,
      eventType: "complaint.created",
      payload: payloadFor(ticket, "complaint.created"),
      recipients: recipientsFor(ticket),
    })
    if (notificationId) ids.push(notificationId)
    await tx.auditLog.create({
      data: {
        action: "ticket.created",
        entityType: "ComplaintTicket",
        entityId: ticket.id,
        after: { reference, status, source: routing.source, submissionId: input.submissionId },
      },
    })
  }
  return ids
}

async function groupFor(
  tx: Prisma.TransactionClient,
  input: { settings: SettingValues; locationId: string; restroomCategory: "MALE" | "FEMALE"; receivedAt: Date },
  reasonId: string | null,
) {
  if (!input.settings["ticket.groupingEnabled"] || !reasonId) return null
  const minutes = Number(input.settings["ticket.groupingWindowMinutes"]) || 60
  const existing = await tx.complaintGroup.findFirst({
    where: {
      locationId: input.locationId,
      restroomCategory: input.restroomCategory,
      reasonId,
      windowStart: { lte: input.receivedAt },
      windowEnd: { gte: input.receivedAt },
    },
  })
  if (existing) return existing.id
  const created = await tx.complaintGroup.create({
    data: {
      locationId: input.locationId,
      restroomCategory: input.restroomCategory,
      reasonId,
      windowStart: input.receivedAt,
      windowEnd: new Date(input.receivedAt.getTime() + minutes * 60000),
    },
  })
  return created.id
}

async function nextReference(tx: Prisma.TransactionClient, at: Date) {
  const key = `ticket-${at.getUTCFullYear()}`
  const row = await tx.counter.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  })
  return `DMY-${at.getUTCFullYear()}-${String(row.value).padStart(5, "0")}`
}

type TicketRecord = Prisma.ComplaintTicketGetPayload<{ include: typeof ticketInclude }>

function payloadFor(ticket: TicketRecord, eventType: string): NoticePayload {
  const location = `${ticket.location.floor.building.name} · ${ticket.location.name}`
  return {
    reference: ticket.reference,
    location,
    category: ticket.restroomCategory,
    rating: ticket.rating,
    reasons: ticket.reasons.map((item) => item.reason.label),
    eventAt: ticket.eventAt.toISOString(),
    status: ticket.status,
    link: ticketLink(ticket.id),
    eventType,
  }
}

function recipientsFor(ticket: TicketRecord) {
  const recipients = []
  if (ticket.assignedStaff) {
    recipients.push({
      role: "PRIMARY" as const,
      staffId: ticket.assignedStaff.id,
      userId: ticket.assignedStaff.userId,
      phone: ticket.assignedStaff.phone,
    })
  }
  if (ticket.fallbackUser) {
    recipients.push({
      role: "FALLBACK" as const,
      userId: ticket.fallbackUser.id,
      phone: ticket.fallbackUser.phone,
    })
  }
  if (ticket.location.supervisor && ticket.location.supervisor.id !== ticket.fallbackUser?.id && ticket.location.supervisor.id !== ticket.assignedStaff?.userId) {
    recipients.push({
      role: "SUPERVISOR" as const,
      userId: ticket.location.supervisor.id,
      phone: ticket.location.supervisor.phone,
    })
  }
  return recipients
}

export async function listTickets(actor: Actor, filters: TicketFilters) {
  const settings = await getSettings()
  const where = await ticketWhere(actor, filters, settings["app.timezone"])
  const [total, rows, configs] = await Promise.all([
    prisma.complaintTicket.count({ where }),
    prisma.complaintTicket.findMany({
      where,
      include: ticketInclude,
      orderBy: { receivedAt: "desc" },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    prisma.slaConfiguration.findMany(),
  ])
  return {
    items: rows.map((ticket) => serializeTicket(ticket, configs, settings)),
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    timeZone: settings["app.timezone"],
  }
}

export async function getTicket(actor: Actor, id: string) {
  const ticket = await prisma.complaintTicket.findUnique({
    where: { id },
    include: {
      ...ticketInclude,
      comments: { include: { author: true }, orderBy: { createdAt: "asc" } },
      statusHistory: { include: { actor: true }, orderBy: { createdAt: "asc" } },
      assignmentHistory: { include: { toStaff: true, fromStaff: true, actor: true }, orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "asc" } },
      group: { include: { tickets: { select: { id: true, reference: true, status: true } } } },
    },
  })
  if (!ticket) throw new AppError(404, "NOT_FOUND", "Ticket not found.")
  await assertTicketAccess(actor, ticket)
  const [configs, settings] = await Promise.all([prisma.slaConfiguration.findMany(), getSettings()])
  return {
    ...serializeTicket(ticket, configs, settings),
    comments: ticket.comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      author: comment.author?.name ?? "System",
      createdAt: comment.createdAt.toISOString(),
    })),
    statusHistory: ticket.statusHistory.map((item) => ({
      id: item.id,
      fromStatus: item.fromStatus,
      toStatus: item.toStatus,
      actor: item.actor?.name ?? "System",
      note: item.note,
      createdAt: item.createdAt.toISOString(),
    })),
    assignmentHistory: ticket.assignmentHistory.map((item) => ({
      id: item.id,
      fromStaff: item.fromStaff?.name ?? null,
      toStaff: item.toStaff?.name ?? null,
      source: item.source,
      reason: item.reason,
      actor: item.actor?.name ?? "System",
      createdAt: item.createdAt.toISOString(),
    })),
    events: ticket.events.map((event) => ({
      id: event.id,
      type: event.type,
      message: event.message,
      createdAt: event.createdAt.toISOString(),
    })),
    group: ticket.group
      ? {
          id: ticket.group.id,
          tickets: ticket.group.tickets,
        }
      : null,
    submissions: ticket.feedbackLinks.map((link) => ({
      id: link.submission.id,
      clientSubmissionId: link.submission.clientSubmissionId,
      rating: link.submission.rating,
      category: link.submission.restroomCategory,
      eventAt: link.submission.eventAt.toISOString(),
      receivedAt: link.submission.receivedAt.toISOString(),
      otherText: link.submission.otherText,
      deviceCode: link.submission.device.code,
      reasons: link.submission.reasons.map((item) => item.reason.label),
    })),
  }
}

export async function transitionTicket(actor: Actor, id: string, to: TicketStatus, note: string | null, requestId?: string) {
  if (!["NEW", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"].includes(to)) {
    throw new AppError(400, "VALIDATION", "Unknown ticket status.")
  }
  const permission = permissionForTransition(to)
  if (!hasPermission(actor, permission)) throw new AppError(403, "FORBIDDEN", "You do not have access to this action.")
  const existing = await prisma.complaintTicket.findUnique({ where: { id } })
  if (!existing) throw new AppError(404, "NOT_FOUND", "Ticket not found.")
  await assertTicketAccess(actor, existing)
  if (actor.roleKey === "STAFF" && existing.assignedStaffId !== actor.staffId) {
    throw new AppError(403, "FORBIDDEN", "You can update only tickets assigned to you.")
  }
  if (!canTransition(existing.status, to)) {
    throw new AppError(409, "CONFLICT", `A ticket cannot move from ${existing.status} to ${to}.`)
  }
  const now = new Date()
  const notificationIds = await prisma.$transaction(async (tx) => {
    const data: Prisma.ComplaintTicketUpdateInput = { status: to }
    if (to === "IN_PROGRESS" && !existing.acknowledgedAt) data.acknowledgedAt = now
    if (to === "RESOLVED") data.resolvedAt = now
    if (to === "CLOSED") data.closedAt = now
    if (to === "IN_PROGRESS" && existing.status === "RESOLVED") {
      data.resolvedAt = null
      data.closedAt = null
    }
    await tx.complaintTicket.update({ where: { id }, data })
    await tx.ticketStatusHistory.create({
      data: { ticketId: id, fromStatus: existing.status, toStatus: to, actorId: actor.id, note },
    })
    if (note) {
      await tx.ticketComment.create({ data: { ticketId: id, authorId: actor.id, body: note } })
    }
    await tx.ticketEvent.create({
      data: { ticketId: id, type: "status", message: `Status changed from ${existing.status} to ${to}.` },
    })
    const ticket = await tx.complaintTicket.findUniqueOrThrow({ where: { id }, include: ticketInclude })
    const eventType = to === "IN_PROGRESS" && existing.status === "ASSIGNED" ? "complaint.acknowledged" : "complaint.status_changed"
    const notificationId = await queueNotification(tx, {
      ticketId: id,
      eventType,
      qualifier: eventType === "complaint.status_changed" ? to : undefined,
      payload: payloadFor(ticket, eventType),
      recipients: recipientsFor(ticket).filter((recipient) => recipient.userId !== actor.id),
    })
    return notificationId ? [notificationId] : []
  })
  await writeAudit({
    actorId: actor.id,
    action: "ticket.transition",
    entityType: "ComplaintTicket",
    entityId: id,
    before: { status: existing.status },
    after: { status: to },
    reason: note,
    requestId,
  })
  await dispatchMany(notificationIds)
  return getTicket(actor, id)
}

export async function commentOnTicket(actor: Actor, id: string, body: string, requestId?: string) {
  if (!hasPermission(actor, "tickets.comment") && !hasPermission(actor, "tickets.update")) {
    throw new AppError(403, "FORBIDDEN", "You do not have access to this action.")
  }
  const existing = await prisma.complaintTicket.findUnique({ where: { id } })
  if (!existing) throw new AppError(404, "NOT_FOUND", "Ticket not found.")
  await assertTicketAccess(actor, existing)
  if (actor.roleKey === "STAFF" && existing.assignedStaffId !== actor.staffId) {
    throw new AppError(403, "FORBIDDEN", "You can update only tickets assigned to you.")
  }
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.ticketComment.create({ data: { ticketId: id, authorId: actor.id, body } })
    if (existing.status === "IN_PROGRESS" && !existing.firstProgressAt) {
      await tx.complaintTicket.update({ where: { id }, data: { firstProgressAt: now } })
    }
    await tx.ticketEvent.create({ data: { ticketId: id, type: "comment", message: "Progress note added." } })
  })
  await writeAudit({
    actorId: actor.id,
    action: "ticket.comment",
    entityType: "ComplaintTicket",
    entityId: id,
    after: { body },
    requestId,
  })
  return getTicket(actor, id)
}

export async function reassignTicket(actor: Actor, id: string, staffId: string, reason: string, requestId?: string) {
  if (!hasPermission(actor, "tickets.assign")) throw new AppError(403, "FORBIDDEN", "You do not have access to this action.")
  if (!reason.trim()) throw new AppError(400, "VALIDATION", "A reason is required to reassign a ticket.")
  const existing = await prisma.complaintTicket.findUnique({ where: { id } })
  if (!existing) throw new AppError(404, "NOT_FOUND", "Ticket not found.")
  if (existing.status === "CLOSED") throw new AppError(409, "CONFLICT", "Closed tickets cannot be reassigned.")
  await assertTicketAccess(actor, existing)
  const staff = await prisma.staff.findUnique({ where: { id: staffId } })
  if (!staff || !staff.active) throw new AppError(400, "VALIDATION", "Choose an active staff member.")
  const notificationIds = await prisma.$transaction(async (tx) => {
    const history = await tx.ticketAssignmentHistory.create({
      data: {
        ticketId: id,
        fromStaffId: existing.assignedStaffId,
        toStaffId: staffId,
        source: "REPLACEMENT",
        reason,
        actorId: actor.id,
      },
    })
    await tx.complaintTicket.update({
      where: { id },
      data: {
        assignedStaffId: staffId,
        assignmentSource: "REPLACEMENT",
        fallbackUserId: null,
        fallbackReason: null,
        status: existing.status === "NEW" ? "ASSIGNED" : existing.status,
      },
    })
    if (existing.status === "NEW") {
      await tx.ticketStatusHistory.create({
        data: { ticketId: id, fromStatus: "NEW", toStatus: "ASSIGNED", actorId: actor.id, note: reason },
      })
    }
    await tx.ticketEvent.create({ data: { ticketId: id, type: "reassigned", message: `Reassigned to ${staff.name}. ${reason}` } })
    const ticket = await tx.complaintTicket.findUniqueOrThrow({ where: { id }, include: ticketInclude })
    const notificationId = await queueNotification(tx, {
      ticketId: id,
      eventType: "complaint.assigned",
      qualifier: history.id,
      payload: payloadFor(ticket, "complaint.assigned"),
      recipients: recipientsFor(ticket),
    })
    return notificationId ? [notificationId] : []
  })
  await writeAudit({
    actorId: actor.id,
    action: "ticket.reassign",
    entityType: "ComplaintTicket",
    entityId: id,
    before: { assignedStaffId: existing.assignedStaffId },
    after: { assignedStaffId: staffId },
    reason,
    requestId,
  })
  await dispatchMany(notificationIds)
  return getTicket(actor, id)
}

export type TicketFilters = {
  from?: string
  to?: string
  buildingId?: string
  locationId?: string
  category?: "MALE" | "FEMALE"
  status?: string
  reasonId?: string
  staffId?: string
  q?: string
  page: number
  pageSize: number
}

async function ticketWhere(actor: Actor, filters: TicketFilters, timeZone: string): Promise<Prisma.ComplaintTicketWhereInput> {
  const today = localDateString(new Date(), timeZone)
  const from = filters.from || addDays(today, -29)
  const to = filters.to || today
  const range = span(from, to, timeZone)
  const location = await accessibleLocationFilter(actor)
  const and: Prisma.ComplaintTicketWhereInput[] = [
    { receivedAt: { gte: range.start, lt: range.end } },
    filters.category ? { restroomCategory: filters.category } : {},
    filters.status ? { status: filters.status as TicketStatus } : {},
    filters.staffId ? { assignedStaffId: filters.staffId } : {},
    filters.reasonId ? { reasons: { some: { reasonId: filters.reasonId } } } : {},
    filters.q ? { reference: { contains: filters.q, mode: "insensitive" } } : {},
    filters.buildingId ? { location: { floor: { buildingId: filters.buildingId } } } : {},
    filters.locationId ? { locationId: filters.locationId } : {},
  ]
  if (actor.roleKey === "STAFF" && actor.staffId) {
    and.push({ OR: [{ assignedStaffId: actor.staffId }, { location }] })
  } else {
    and.push({ location })
  }
  return { AND: and }
}

function serializeTicket(
  ticket: TicketRecord,
  configs: Array<{
    id: string
    active: boolean
    priority: string | null
    locationId: string | null
    reasonId: string | null
    responseMinutes: number | null
    progressMinutes: number | null
    resolutionMinutes: number | null
    graceMinutes: number
  }>,
  settings: SettingValues,
) {
  const config = pickSlaConfig(configs, {
    priority: ticket.priority,
    locationId: ticket.locationId,
    reasonIds: ticket.reasons.map((item) => item.reasonId),
  })
  const notificationDelayed = ticket.notifications.some((item) => item.status === "FAILED")
  const sla = slaAssessment({
    now: new Date(),
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
    notificationDelayed,
  })
  return {
    id: ticket.id,
    reference: ticket.reference,
    status: ticket.status,
    priority: ticket.priority,
    rating: ticket.rating,
    category: ticket.restroomCategory,
    policy: ticket.policy,
    locationId: ticket.locationId,
    locationName: ticket.location.name,
    buildingName: ticket.location.floor.building.name,
    floorName: ticket.location.floor.name,
    assignedStaffId: ticket.assignedStaffId,
    assignedStaffName: ticket.assignedStaff?.name ?? null,
    fallbackUserName: ticket.fallbackUser?.name ?? null,
    assignmentSource: ticket.assignmentSource,
    fallbackReason: ticket.fallbackReason,
    reasons: ticket.reasons.map((item) => ({ id: item.reasonId, label: item.reason.label })),
    eventAt: ticket.eventAt.toISOString(),
    receivedAt: ticket.receivedAt.toISOString(),
    acknowledgedAt: ticket.acknowledgedAt?.toISOString() ?? null,
    firstProgressAt: ticket.firstProgressAt?.toISOString() ?? null,
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
    closedAt: ticket.closedAt?.toISOString() ?? null,
    createdAt: ticket.createdAt.toISOString(),
    sla,
    provisionalPolicy: true,
  }
}

export async function setTicketPriority(actor: Actor, id: string, priority: TicketPriority, requestId?: string) {
  if (!hasPermission(actor, "tickets.assign")) throw new AppError(403, "FORBIDDEN", "You do not have access to this action.")
  const existing = await prisma.complaintTicket.findUnique({ where: { id } })
  if (!existing) throw new AppError(404, "NOT_FOUND", "Ticket not found.")
  await assertTicketAccess(actor, existing)
  await prisma.complaintTicket.update({ where: { id }, data: { priority } })
  await writeAudit({
    actorId: actor.id,
    action: "ticket.priority",
    entityType: "ComplaintTicket",
    entityId: id,
    before: { priority: existing.priority },
    after: { priority },
    requestId,
  })
  return getTicket(actor, id)
}

