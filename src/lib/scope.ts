import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { AppError } from "@/lib/errors"
import type { Actor } from "@/lib/permissions"

export async function accessibleLocationFilter(actor: Actor): Promise<Prisma.RestroomLocationWhereInput> {
  if (actor.roleKey === "ADMIN") return {}
  if (actor.roleKey === "MANAGEMENT" && actor.areaAccess.length === 0) return {}

  const buildingIds = actor.areaAccess.map((access) => access.buildingId).filter((id): id is string => Boolean(id))
  const locationIds = actor.areaAccess.map((access) => access.locationId).filter((id): id is string => Boolean(id))

  if (actor.staffId) {
    const coverage = await prisma.staffAreaCoverage.findMany({
      where: {
        staffId: actor.staffId,
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
      },
      select: { locationId: true },
    })
    locationIds.push(...coverage.map((item) => item.locationId))
  }

  const or: Prisma.RestroomLocationWhereInput[] = []
  if (locationIds.length) or.push({ id: { in: [...new Set(locationIds)] } })
  if (buildingIds.length) or.push({ floor: { buildingId: { in: [...new Set(buildingIds)] } } })
  if (!or.length) return { id: { in: [] } }
  return { OR: or }
}

export async function assertLocationAccess(actor: Actor, locationId: string) {
  const where = await accessibleLocationFilter(actor)
  const count = await prisma.restroomLocation.count({ where: { AND: [{ id: locationId }, where] } })
  if (!count) throw new AppError(403, "FORBIDDEN", "You do not have access to this location.")
}

export async function assertTicketAccess(
  actor: Actor,
  ticket: { locationId: string; assignedStaffId: string | null },
) {
  if (actor.roleKey === "STAFF" && actor.staffId && ticket.assignedStaffId === actor.staffId) return
  await assertLocationAccess(actor, ticket.locationId)
}
