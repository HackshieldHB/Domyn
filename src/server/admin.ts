import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { writeAudit } from "@/lib/audit"
import { AppError } from "@/lib/errors"
import { hashPassword } from "@/lib/password"
import { PERMISSIONS, permissionsForRole, type Actor } from "@/lib/permissions"
import { revokeUserSessions, setUserPassword, validatePassword } from "@/lib/auth"
import { accessibleLocationFilter } from "@/lib/scope"
import { SETTING_CATALOG, SETTING_DEFAULTS, type SettingKey } from "@/server/settings"

export async function listUsers(actor: Actor) {
  if (!actor.permissions.includes("users.manage")) throw new AppError(403, "FORBIDDEN", "You do not have access to this action.")
  const users = await prisma.user.findMany({
    include: { role: true, areaAccess: true, staffProfile: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  })
  return users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    active: user.active,
    phone: user.phone,
    roleId: user.roleId,
    roleKey: user.role.key,
    roleName: user.role.name,
    staffId: user.staffProfile?.id ?? null,
    staffName: user.staffProfile?.name ?? null,
    areaAccess: user.areaAccess.map((access) => ({ buildingId: access.buildingId, locationId: access.locationId })),
  }))
}

export async function saveUser(
  actor: Actor,
  input: {
    id?: string
    name: string
    email: string
    roleKey: string
    active: boolean
    phone?: string | null
    password?: string | null
    staffId?: string | null
    buildingIds: string[]
  },
  requestId?: string,
) {
  if (!actor.permissions.includes("users.manage")) throw new AppError(403, "FORBIDDEN", "You do not have access to this action.")
  if (input.id === actor.id && !input.active) throw new AppError(409, "CONFLICT", "You cannot deactivate your own account.")
  const role = await prisma.role.findUnique({ where: { key: input.roleKey } })
  if (!role) throw new AppError(400, "VALIDATION", "Unknown role.")
  const email = input.email.toLowerCase().trim()
  if (!input.id) {
    if (!input.password) throw new AppError(400, "VALIDATION", "A password is required for a new user.")
    validatePassword(input.password)
  }
  const data = { name: input.name.trim(), email, roleId: role.id, active: input.active, phone: input.phone?.trim() || null }
  const existing = input.id ? await prisma.user.findUnique({ where: { id: input.id } }) : null
  const user = input.id
    ? await prisma.user.update({ where: { id: input.id }, data })
    : await prisma.user.create({ data: { ...data, passwordHash: await hashPassword(input.password as string) } })
  if (input.password && input.id) await setUserPassword(user.id, input.password)
  if (!input.active) await revokeUserSessions(user.id)
  await prisma.userAreaAccess.deleteMany({ where: { userId: user.id } })
  if (input.buildingIds.length) {
    await prisma.userAreaAccess.createMany({ data: input.buildingIds.map((buildingId) => ({ userId: user.id, buildingId })) })
  }
  if (input.staffId) {
    await prisma.staff.updateMany({ where: { userId: user.id }, data: { userId: null } })
    await prisma.staff.update({ where: { id: input.staffId }, data: { userId: user.id } })
  }
  await writeAudit({
    actorId: actor.id,
    action: input.id ? "user.update" : "user.create",
    entityType: "User",
    entityId: user.id,
    before: existing ? { roleId: existing.roleId, active: existing.active } : undefined,
    after: { email, roleKey: input.roleKey, active: input.active, buildingIds: input.buildingIds },
    requestId,
  })
  return user.id
}

export async function listRoles() {
  const roles = await prisma.role.findMany({ include: { permissions: { include: { permission: true } } }, orderBy: { name: "asc" } })
  return {
    permissions: PERMISSIONS.map(([key, description]) => ({ key, description })),
    roles: roles.map((role) => ({
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      permissions: role.permissions.map((item) => item.permission.key),
      defaultPermissions: permissionsForRole(role.key),
    })),
  }
}

export async function updateRolePermissions(actor: Actor, roleKey: string, permissionKeys: string[], requestId?: string) {
  if (!actor.permissions.includes("users.manage")) throw new AppError(403, "FORBIDDEN", "You do not have access to this action.")
  const role = await prisma.role.findUnique({ where: { key: roleKey }, include: { permissions: { include: { permission: true } } } })
  if (!role) throw new AppError(404, "NOT_FOUND", "Role not found.")
  const permissions = await prisma.permission.findMany({ where: { key: { in: permissionKeys } } })
  await prisma.rolePermission.deleteMany({ where: { roleId: role.id } })
  await prisma.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })) })
  await writeAudit({
    actorId: actor.id,
    action: "role.permissions",
    entityType: "Role",
    entityId: role.id,
    before: { permissions: role.permissions.map((item) => item.permission.key) },
    after: { permissions: permissionKeys },
    requestId,
  })
}

export async function listAudit(actor: Actor, page: number, pageSize: number, entityType?: string) {
  if (!actor.permissions.includes("audit.view")) throw new AppError(403, "FORBIDDEN", "You do not have access to this action.")
  const where: Prisma.AuditLogWhereInput = entityType ? { entityType } : {}
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])
  return {
    page,
    pageSize,
    total,
    items: rows.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      actor: row.actor?.name ?? "System",
      reason: row.reason,
      before: row.before,
      after: row.after,
      requestId: row.requestId,
      createdAt: row.createdAt.toISOString(),
    })),
  }
}

export async function settingsView() {
  const rows = await prisma.systemSetting.findMany()
  const stored = new Map(rows.map((row) => [row.key, row]))
  return SETTING_CATALOG.map((item) => ({
    ...item,
    value: stored.get(item.key)?.value ?? SETTING_DEFAULTS[item.key],
    storedProvisional: stored.get(item.key)?.provisional ?? item.provisional,
  }))
}

export async function updateSetting(actor: Actor, key: string, value: unknown, requestId?: string) {
  if (!actor.permissions.includes("settings.manage")) throw new AppError(403, "FORBIDDEN", "You do not have access to this action.")
  const catalog = SETTING_CATALOG.find((item) => item.key === key)
  if (!catalog) throw new AppError(400, "VALIDATION", "That setting cannot be changed.")
  const normalized = normalizeSetting(catalog.key, value)
  const before = await prisma.systemSetting.findUnique({ where: { key } })
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: normalized as Prisma.InputJsonValue, provisional: catalog.provisional, description: catalog.description, updatedById: actor.id },
    update: { value: normalized as Prisma.InputJsonValue, updatedById: actor.id },
  })
  await writeAudit({
    actorId: actor.id,
    action: "setting.update",
    entityType: "SystemSetting",
    entityId: key,
    before: before ? { value: before.value as Prisma.InputJsonValue } : undefined,
    after: { value: normalized as Prisma.InputJsonValue },
    requestId,
  })
}

function normalizeSetting(key: SettingKey, value: unknown) {
  const sample = SETTING_DEFAULTS[key]
  if (typeof sample === "number") {
    const number = Number(value)
    if (!Number.isFinite(number)) throw new AppError(400, "VALIDATION", "Enter a number.")
    return number
  }
  if (typeof sample === "boolean") return value === true || value === "true"
  if (key === "ticket.policy" && value !== "PER_SUBMISSION" && value !== "PER_REASON") {
    throw new AppError(400, "VALIDATION", "Ticket policy must be PER_SUBMISSION or PER_REASON.")
  }
  if (key === "sla.clock" && value !== "RECEIVED_AT" && value !== "EVENT_AT") {
    throw new AppError(400, "VALIDATION", "SLA clock must be RECEIVED_AT or EVENT_AT.")
  }
  if (key === "checkin.method" && value !== "TABLET" && value !== "MOBILE") {
    throw new AppError(400, "VALIDATION", "Check-in method must be TABLET or MOBILE.")
  }
  if (typeof value !== "string") throw new AppError(400, "VALIDATION", "Enter a text value.")
  return value
}

export async function listDecisions() {
  const rows = await prisma.decision.findMany({ include: { history: { include: { actor: true }, orderBy: { createdAt: "desc" } } }, orderBy: { code: "asc" } })
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    topic: row.topic,
    status: row.status,
    proposedDefault: row.proposedDefault,
    owner: row.owner,
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
    history: row.history.map((item) => ({
      id: item.id,
      status: item.status,
      note: item.note,
      actor: item.actor?.name ?? "System",
      createdAt: item.createdAt.toISOString(),
    })),
  }))
}

export async function annotateDecision(actor: Actor, id: string, note: string, status?: "PENDING" | "PROVISIONAL" | "APPROVED" | "REJECTED") {
  if (!actor.permissions.includes("decisions.manage")) throw new AppError(403, "FORBIDDEN", "You do not have access to this action.")
  const decision = await prisma.decision.findUnique({ where: { id } })
  if (!decision) throw new AppError(404, "NOT_FOUND", "Decision not found.")
  await prisma.decision.update({ where: { id }, data: { notes: note || decision.notes, status: status ?? decision.status } })
  await prisma.decisionHistory.create({ data: { decisionId: id, status: status ?? decision.status, note, actorId: actor.id } })
  await writeAudit({ actorId: actor.id, action: "decision.note", entityType: "Decision", entityId: id, after: { status: status ?? decision.status, note } })
}

export async function listNotifications(actor: Actor, page: number, pageSize: number) {
  if (!actor.permissions.includes("notifications.view")) throw new AppError(403, "FORBIDDEN", "You do not have access to this action.")
  const where = { ticket: { location: await accessibleLocationFilter(actor) } }
  const [total, rows] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      include: { ticket: { select: { reference: true, id: true } }, attempts: { orderBy: { attemptedAt: "desc" } }, recipients: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])
  return {
    page,
    pageSize,
    total,
    provider: process.env.WHATSAPP_PROVIDER === "whatsapp" ? "whatsapp" : "sandbox",
    items: rows.map((row) => ({
      id: row.id,
      eventType: row.eventType,
      status: row.status,
      mode: row.mode,
      simulated: row.mode === "SANDBOX",
      reference: row.ticket?.reference ?? null,
      ticketId: row.ticketId,
      createdAt: row.createdAt.toISOString(),
      recipients: row.recipients.map((recipient) => ({ role: recipient.role, phoneMasked: recipient.phoneMasked })),
      attempts: row.attempts.map((attempt) => ({
        id: attempt.id,
        provider: attempt.provider,
        success: attempt.success,
        simulated: attempt.simulated,
        error: attempt.error,
        attemptedAt: attempt.attemptedAt.toISOString(),
      })),
    })),
  }
}
