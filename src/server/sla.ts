import { prisma } from "@/lib/db"
import { writeAudit } from "@/lib/audit"
import { AppError } from "@/lib/errors"
import type { Actor } from "@/lib/permissions"
import { pickSlaConfig, slaAssessment } from "@/server/domain"
import { dispatchMany, queueNotification, ticketLink } from "@/server/notifications"
import { getSettings } from "@/server/settings"

export async function runSlaSweep(actor: Actor | null, now = new Date()) {
  const settings = await getSettings()
  if (!settings["sla.escalationEnabled"]) {
    return { checked: 0, escalated: 0, message: "Escalation is disabled until SLA rules are approved." }
  }
  const [tickets, configs] = await Promise.all([
    prisma.complaintTicket.findMany({
      where: { status: { in: ["NEW", "ASSIGNED", "IN_PROGRESS"] } },
      include: {
        location: { include: { floor: { include: { building: true } }, supervisor: true } },
        assignedStaff: true,
        fallbackUser: true,
        reasons: { include: { reason: true } },
        notifications: { select: { status: true, createdAt: true, mode: true } },
      },
    }),
    prisma.slaConfiguration.findMany(),
  ])
  let escalated = 0
  const notificationIds: string[] = []
  for (const ticket of tickets) {
    const config = pickSlaConfig(configs, {
      priority: ticket.priority,
      locationId: ticket.locationId,
      reasonIds: ticket.reasons.map((item) => item.reasonId),
    })
    const assessment = slaAssessment({
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
      notificationDelayed: ticket.notifications.some((item) => item.status === "FAILED"),
    })
    if (!assessment.states.includes("OVERDUE") || !config) continue
    const dedupeKey = `sla:overdue:${ticket.id}:${config.id}`
    const existing = await prisma.slaEvent.findUnique({ where: { dedupeKey } })
    if (existing) continue
    const ids = await prisma.$transaction(async (tx) => {
      await tx.slaEvent.create({
        data: {
          ticketId: ticket.id,
          type: "OVERDUE",
          dedupeKey,
          message: "Response threshold exceeded under the active provisional SLA configuration.",
        },
      })
      const payload = {
        reference: ticket.reference,
        location: `${ticket.location.floor.building.name} · ${ticket.location.name}`,
        category: ticket.restroomCategory,
        rating: ticket.rating,
        reasons: ticket.reasons.map((item) => item.reason.label),
        eventAt: ticket.eventAt.toISOString(),
        status: ticket.status,
        link: ticketLink(ticket.id),
        eventType: "complaint.overdue",
      }
      const recipients = []
      if (ticket.assignedStaff) {
        recipients.push({ role: "PRIMARY" as const, staffId: ticket.assignedStaff.id, userId: ticket.assignedStaff.userId, phone: ticket.assignedStaff.phone })
      }
      if (config.escalationUserId) {
        const user = await tx.user.findUnique({ where: { id: config.escalationUserId } })
        if (user) recipients.push({ role: "FALLBACK" as const, userId: user.id, phone: user.phone })
      } else if (ticket.location.supervisor) {
        recipients.push({ role: "SUPERVISOR" as const, userId: ticket.location.supervisor.id, phone: ticket.location.supervisor.phone })
      }
      const overdueId = await queueNotification(tx, { ticketId: ticket.id, eventType: "complaint.overdue", payload, recipients })
      const escalatedId = config.escalationUserId
        ? await queueNotification(tx, {
            ticketId: ticket.id,
            eventType: "complaint.escalated",
            payload: { ...payload, eventType: "complaint.escalated" },
            recipients: recipients.filter((item) => item.role !== "PRIMARY"),
          })
        : null
      return [overdueId, escalatedId].filter((id): id is string => Boolean(id))
    })
    notificationIds.push(...ids)
    escalated += 1
  }
  await dispatchMany(notificationIds)
  if (actor) {
    await writeAudit({
      actorId: actor.id,
      action: "sla.sweep",
      entityType: "SlaEvent",
      entityId: "sweep",
      after: { checked: tickets.length, escalated },
    })
  }
  return { checked: tickets.length, escalated, message: "SLA sweep completed." }
}

export async function saveSlaConfig(
  actor: Actor,
  input: {
    id?: string
    name: string
    priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT" | null
    locationId?: string | null
    reasonId?: string | null
    responseMinutes?: number | null
    progressMinutes?: number | null
    resolutionMinutes?: number | null
    graceMinutes: number
    escalationUserId?: string | null
    active: boolean
    notes?: string | null
  },
) {
  if (!actor.permissions.includes("sla.manage")) throw new AppError(403, "FORBIDDEN", "You do not have access to this action.")
  const data = {
    name: input.name.trim(),
    priority: input.priority || null,
    locationId: input.locationId || null,
    reasonId: input.reasonId || null,
    responseMinutes: input.responseMinutes ?? null,
    progressMinutes: input.progressMinutes ?? null,
    resolutionMinutes: input.resolutionMinutes ?? null,
    graceMinutes: input.graceMinutes,
    escalationUserId: input.escalationUserId || null,
    active: input.active,
    provisional: true,
    notes: input.notes?.trim() || null,
  }
  const row = input.id
    ? await prisma.slaConfiguration.update({ where: { id: input.id }, data })
    : await prisma.slaConfiguration.create({ data })
  await writeAudit({
    actorId: actor.id,
    action: input.id ? "sla.update" : "sla.create",
    entityType: "SlaConfiguration",
    entityId: row.id,
    after: { ...data, approval: "provisional" },
  })
  return row.id
}

export async function listSla(actor: Actor) {
  const [configs, settings, events] = await Promise.all([
    prisma.slaConfiguration.findMany({
      include: { location: true, reason: true, escalationUser: true },
      orderBy: { name: "asc" },
    }),
    getSettings(),
    prisma.slaEvent.findMany({
      include: { ticket: { select: { reference: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ])
  return {
    actor: actor.roleKey,
    settings: {
      clock: settings["sla.clock"],
      delayedSyncMinutes: settings["sla.delayedSyncMinutes"],
      escalationEnabled: settings["sla.escalationEnabled"],
    },
    configs: configs.map((config) => ({
      id: config.id,
      name: config.name,
      priority: config.priority,
      locationId: config.locationId,
      locationName: config.location?.name ?? "All locations",
      reasonId: config.reasonId,
      reasonLabel: config.reason?.label ?? "All reasons",
      responseMinutes: config.responseMinutes,
      progressMinutes: config.progressMinutes,
      resolutionMinutes: config.resolutionMinutes,
      graceMinutes: config.graceMinutes,
      escalationUserId: config.escalationUserId,
      escalationUserName: config.escalationUser?.name ?? null,
      active: config.active,
      provisional: config.provisional,
      notes: config.notes,
    })),
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      message: event.message,
      reference: event.ticket.reference,
      ticketId: event.ticketId,
      createdAt: event.createdAt.toISOString(),
    })),
    notice:
      "Response thresholds are provisional until TLT approves the SLA. A 15–20 minute discussion point is not applied automatically and is not a resolution deadline.",
  }
}
