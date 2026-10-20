import { prisma, isUniqueConstraint } from "@/lib/db"
import { AppError } from "@/lib/errors"
import type { Actor } from "@/lib/permissions"
import { accessibleLocationFilter } from "@/lib/scope"
import { addDays, localDateString, span } from "@/lib/time"
import { isSuspiciousDrift, validateSurvey } from "@/server/domain"
import { createTicketsForSubmission } from "@/server/complaints"
import { dispatchMany } from "@/server/notifications"
import { getSettings } from "@/server/settings"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type SubmissionInput = {
  deviceCode: string
  clientSubmissionId: string
  restroomCategory: "MALE" | "FEMALE"
  rating: number
  reasonCodes: string[]
  otherText?: string | null
  eventAt: string | Date
  receivedAt?: Date
  userAgent?: string | null
}

export async function ingestSubmission(input: SubmissionInput) {
  if (!UUID.test(input.clientSubmissionId)) {
    throw new AppError(400, "VALIDATION", "Submission id must be a UUID.")
  }
  const device = await prisma.device.findUnique({ where: { code: input.deviceCode } })
  if (!device || !device.active) throw new AppError(404, "DEVICE", "This device is not active.")
  const settings = await getSettings()
  const reasons = await prisma.feedbackReason.findMany()
  const checked = validateSurvey({
    rating: input.rating,
    restroomCategory: input.restroomCategory,
    reasonCodes: input.reasonCodes,
    otherText: input.otherText,
    negativeMax: Number(settings["survey.negativeMaxRating"]),
    reasons,
  })
  if (!checked.ok) throw new AppError(400, "VALIDATION", checked.message)
  const receivedAt = input.receivedAt ?? new Date()
  const eventAt = new Date(input.eventAt)
  if (Number.isNaN(eventAt.getTime())) throw new AppError(400, "VALIDATION", "Event time is invalid.")
  if (eventAt.getTime() > receivedAt.getTime() + 5 * 60 * 1000) {
    throw new AppError(400, "CLOCK", "The device event time is too far in the future.")
  }
  const drift = eventAt.getTime() - receivedAt.getTime()
  try {
    const created = await prisma.$transaction(async (tx) => {
      const existing = await tx.feedbackSubmission.findUnique({
        where: { clientSubmissionId: input.clientSubmissionId },
        include: { ticketLinks: true },
      })
      if (existing) {
        return {
          created: false,
          submissionId: existing.id,
          ticketIds: existing.ticketLinks.map((link) => link.ticketId),
          notificationIds: [] as string[],
        }
      }
      const submission = await tx.feedbackSubmission.create({
        data: {
          clientSubmissionId: input.clientSubmissionId,
          deviceId: device.id,
          locationId: device.locationId,
          restroomCategory: input.restroomCategory,
          rating: input.rating,
          otherText: input.otherText?.trim() || null,
          eventAt,
          receivedAt,
          syncStatus: "SYNCED",
          clockDriftMs: drift,
          userAgent: input.userAgent?.slice(0, 300) ?? null,
          reasons: {
            create: input.reasonCodes.map((code) => ({ reason: { connect: { code } } })),
          },
        },
      })
      if (isSuspiciousDrift(drift, Number(settings["sla.delayedSyncMinutes"]))) {
        await tx.device.update({ where: { id: device.id }, data: { clockDriftMs: drift } })
      }
      const notificationIds = await createTicketsForSubmission(tx, {
        submissionId: submission.id,
        locationId: device.locationId,
        deviceCode: device.code,
        restroomCategory: input.restroomCategory,
        rating: input.rating,
        reasonCodes: input.reasonCodes,
        eventAt,
        receivedAt,
        settings,
      })
      return { created: true, submissionId: submission.id, notificationIds }
    })
    if (created.created) await dispatchMany(created.notificationIds)
    return { created: created.created, submissionId: created.submissionId }
  } catch (error) {
    if (isUniqueConstraint(error)) {
      const existing = await prisma.feedbackSubmission.findUnique({ where: { clientSubmissionId: input.clientSubmissionId } })
      if (existing) return { created: false, submissionId: existing.id }
    }
    throw error
  }
}

export async function syncBatch(
  deviceCode: string,
  items: SubmissionInput[],
  userAgent?: string | null,
) {
  if (items.length > 50) throw new AppError(400, "VALIDATION", "A sync batch can contain at most 50 submissions.")
  const results = []
  for (const item of items) {
    try {
      const result = await ingestSubmission({ ...item, deviceCode, userAgent })
      results.push({
        clientSubmissionId: item.clientSubmissionId,
        status: "SYNCED" as const,
        duplicate: !result.created,
        submissionId: result.submissionId,
      })
    } catch (error) {
      results.push({
        clientSubmissionId: item.clientSubmissionId,
        status: "FAILED" as const,
        error: error instanceof AppError ? error.message : "The submission could not be stored.",
      })
    }
  }
  const device = await prisma.device.findUnique({ where: { code: deviceCode } })
  if (device) {
    const firstError = results.find((item) => item.status === "FAILED" && "error" in item)
    await prisma.device.update({
      where: { id: device.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncError: firstError && "error" in firstError ? firstError.error : null,
      },
    })
  }
  return results
}

export async function listFeedback(actor: Actor, filters: {
  from?: string
  to?: string
  buildingId?: string
  locationId?: string
  category?: "MALE" | "FEMALE"
  deviceId?: string
  reasonId?: string
  rating?: number
  q?: string
  page: number
  pageSize: number
}) {
  const settings = await getSettings()
  const today = localDateString(new Date(), settings["app.timezone"])
  const range = span(filters.from || addDays(today, -13), filters.to || today, settings["app.timezone"])
  const where = {
    AND: [
      { receivedAt: { gte: range.start, lt: range.end } },
      { location: await accessibleLocationFilter(actor) },
      filters.locationId ? { locationId: filters.locationId } : {},
      filters.buildingId ? { location: { floor: { buildingId: filters.buildingId } } } : {},
      filters.category ? { restroomCategory: filters.category } : {},
      filters.deviceId ? { deviceId: filters.deviceId } : {},
      filters.rating ? { rating: filters.rating } : {},
      filters.reasonId ? { reasons: { some: { reasonId: filters.reasonId } } } : {},
    ],
  }
  const [total, rows] = await Promise.all([
    prisma.feedbackSubmission.count({ where }),
    prisma.feedbackSubmission.findMany({
      where,
      include: {
        location: { include: { floor: { include: { building: true } } } },
        device: true,
        reasons: { include: { reason: true } },
        ticketLinks: { include: { ticket: { select: { id: true, reference: true, status: true } } } },
      },
      orderBy: { receivedAt: "desc" },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ])
  return {
    timeZone: settings["app.timezone"],
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    items: rows.map((row) => ({
      id: row.id,
      clientSubmissionId: row.clientSubmissionId,
      rating: row.rating,
      category: row.restroomCategory,
      otherText: row.otherText,
      eventAt: row.eventAt.toISOString(),
      receivedAt: row.receivedAt.toISOString(),
      clockDriftMs: row.clockDriftMs,
      syncStatus: row.syncStatus,
      locationName: row.location.name,
      buildingName: row.location.floor.building.name,
      floorName: row.location.floor.name,
      deviceCode: row.device.code,
      reasons: row.reasons.map((item) => item.reason.label),
      tickets: row.ticketLinks.map((link) => link.ticket),
    })),
  }
}
