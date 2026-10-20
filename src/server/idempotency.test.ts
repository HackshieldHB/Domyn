import { afterAll, describe, expect, it } from "vitest"
import { prisma } from "@/lib/db"
import { permissionsForRole } from "@/lib/permissions"
import { ingestSubmission } from "@/server/feedback"
import { recordReplacement } from "@/server/workforce"

const clientSubmissionId = crypto.randomUUID()
let createdSubmissionId = ""
let replacementId = ""

describe("database integrity", () => {
  it("stores a negative submission once and opens a traceable ticket", async () => {
    const device = await prisma.device.findFirst({ where: { active: true } })
    expect(device).toBeTruthy()
    const input = {
      deviceCode: device!.code,
      clientSubmissionId,
      restroomCategory: "FEMALE" as const,
      rating: 2,
      reasonCodes: ["ODOR", "FLOOR"],
      eventAt: new Date().toISOString(),
    }
    const first = await ingestSubmission(input)
    const second = await ingestSubmission(input)
    createdSubmissionId = first.submissionId
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.submissionId).toBe(first.submissionId)
    expect(await prisma.feedbackSubmission.count({ where: { clientSubmissionId } })).toBe(1)
    const links = await prisma.ticketFeedbackLink.findMany({ where: { submissionId: first.submissionId }, include: { ticket: { include: { reasons: true } } } })
    expect(links.length).toBe(1)
    expect(links[0].ticket.reasons.length).toBe(2)
  })

  it("does not treat a positive rating as a complaint", async () => {
    const device = await prisma.device.findFirst({ where: { active: true } })
    const id = crypto.randomUUID()
    const result = await ingestSubmission({
      deviceCode: device!.code,
      clientSubmissionId: id,
      restroomCategory: "MALE",
      rating: 5,
      reasonCodes: [],
      eventAt: new Date().toISOString(),
    })
    const links = await prisma.ticketFeedbackLink.count({ where: { submissionId: result.submissionId } })
    expect(links).toBe(0)
    await prisma.feedbackSubmission.delete({ where: { id: result.submissionId } })
  })

  it("keeps planned assignments when a replacement is recorded", async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@domyn.local" } })
    const [original, replacement, location] = await Promise.all([
      prisma.staff.findUniqueOrThrow({ where: { employeeCode: "S-1002" } }),
      prisma.staff.findUniqueOrThrow({ where: { employeeCode: "S-1005" } }),
      prisma.restroomLocation.findUniqueOrThrow({ where: { code: "tlt-f6" } }),
    ])
    const before = await prisma.plannedAssignment.count({ where: { staffId: original.id, locationId: location.id } })
    expect(before).toBeGreaterThan(0)
    replacementId = await recordReplacement(
      { id: admin.id, roleKey: "ADMIN", permissions: permissionsForRole("ADMIN"), staffId: null, areaAccess: [] },
      {
        originalStaffId: original.id,
        replacementStaffId: replacement.id,
        locationId: location.id,
        reason: "Integration test cover",
        effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
        effectiveTo: new Date(Date.now() + 60_000).toISOString(),
      },
    )
    const after = await prisma.plannedAssignment.count({ where: { staffId: original.id, locationId: location.id } })
    expect(after).toBe(before)
  })
})

afterAll(async () => {
  if (replacementId) await prisma.staffReplacement.delete({ where: { id: replacementId } }).catch(() => undefined)
  if (createdSubmissionId) {
    const links = await prisma.ticketFeedbackLink.findMany({ where: { submissionId: createdSubmissionId } })
    const ticketIds = links.map((link) => link.ticketId)
    await prisma.notificationAttempt.deleteMany({ where: { notification: { ticketId: { in: ticketIds } } } })
    await prisma.notificationRecipient.deleteMany({ where: { notification: { ticketId: { in: ticketIds } } } })
    await prisma.notification.deleteMany({ where: { ticketId: { in: ticketIds } } })
    await prisma.ticketEvent.deleteMany({ where: { ticketId: { in: ticketIds } } })
    await prisma.ticketStatusHistory.deleteMany({ where: { ticketId: { in: ticketIds } } })
    await prisma.ticketAssignmentHistory.deleteMany({ where: { ticketId: { in: ticketIds } } })
    await prisma.ticketReason.deleteMany({ where: { ticketId: { in: ticketIds } } })
    await prisma.ticketFeedbackLink.deleteMany({ where: { submissionId: createdSubmissionId } })
    await prisma.complaintTicket.deleteMany({ where: { id: { in: ticketIds } } })
    await prisma.feedbackSubmissionReason.deleteMany({ where: { submissionId: createdSubmissionId } })
    await prisma.feedbackSubmission.delete({ where: { id: createdSubmissionId } })
  }
  await prisma.$disconnect()
})
