import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"

export async function writeAudit(input: {
  actorId?: string | null
  action: string
  entityType: string
  entityId: string
  before?: Prisma.InputJsonValue | null
  after?: Prisma.InputJsonValue | null
  reason?: string | null
  requestId?: string | null
  ip?: string | null
}) {
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before ?? undefined,
      after: input.after ?? undefined,
      reason: input.reason ?? null,
      requestId: input.requestId ?? null,
      ip: input.ip ?? null,
    },
  })
}
