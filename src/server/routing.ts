import { Prisma, PrismaClient } from "@prisma/client"
import { chooseAssignee, shiftCovers } from "@/server/domain"
import { localDateString, localMinutes, workDate } from "@/lib/time"

type Db = Prisma.TransactionClient | PrismaClient

export type RoutingDecision = {
  staffId: string | null
  source: "PLANNED" | "REPLACEMENT" | "FALLBACK"
  fallbackUserId: string | null
  fallbackReason: string | null
  expectedStaffIds: string[]
}

export async function routeLocation(db: Db, locationId: string, at: Date, timeZone: string): Promise<RoutingDecision> {
  const location = await db.restroomLocation.findUnique({ where: { id: locationId } })
  const replacements = await db.staffReplacement.findMany({
    where: { locationId, effectiveFrom: { lte: at }, effectiveTo: { gt: at } },
    include: { replacementStaff: true },
    orderBy: { createdAt: "asc" },
  })

  if (replacements.length > 0) {
    const absences = await db.staffAbsence.findMany({
      where: {
        staffId: { in: replacements.map((item) => item.replacementStaffId) },
        startAt: { lte: at },
        endAt: { gt: at },
      },
    })
    const absent = new Set(absences.map((item) => item.staffId))
    const candidates = replacements.map((item) => ({
      staffId: item.replacementStaffId,
      source: "REPLACEMENT" as const,
      absent: absent.has(item.replacementStaffId),
      active: item.replacementStaff.active,
    }))
    const chosen = chooseAssignee(candidates)
    const expectedStaffIds = candidates.filter((item) => item.active && !item.absent).map((item) => item.staffId)
    if (chosen) {
      return { staffId: chosen.staffId, source: "REPLACEMENT", fallbackUserId: null, fallbackReason: null, expectedStaffIds }
    }
    return {
      staffId: null,
      source: "FALLBACK",
      fallbackUserId: location?.supervisorUserId ?? null,
      fallbackReason: "A replacement is in effect, but that staff member is unavailable.",
      expectedStaffIds,
    }
  }

  const minute = localMinutes(at, timeZone)
  const planned = await db.plannedAssignment.findMany({
    where: { locationId, workDate: workDate(localDateString(at, timeZone)) },
    include: { shift: true, staff: true },
    orderBy: { staff: { employeeCode: "asc" } },
  })
  const covering = planned.filter((item) => shiftCovers(item.shift, minute))
  const absences = covering.length
    ? await db.staffAbsence.findMany({
        where: {
          staffId: { in: covering.map((item) => item.staffId) },
          startAt: { lte: at },
          endAt: { gt: at },
        },
      })
    : []
  const absent = new Set(absences.map((item) => item.staffId))
  const candidates = covering.map((item) => ({
    staffId: item.staffId,
    source: "PLANNED" as const,
    absent: absent.has(item.staffId),
    active: item.staff.active,
  }))
  const chosen = chooseAssignee(candidates)
  const expectedStaffIds = candidates.filter((item) => item.active && !item.absent).map((item) => item.staffId)
  if (chosen) {
    return { staffId: chosen.staffId, source: "PLANNED", fallbackUserId: null, fallbackReason: null, expectedStaffIds }
  }
  return {
    staffId: null,
    source: "FALLBACK",
    fallbackUserId: location?.supervisorUserId ?? null,
    fallbackReason: covering.length
      ? "Planned staff are absent or inactive for this shift."
      : "No planned assignment covers this location at the routing time.",
    expectedStaffIds,
  }
}
