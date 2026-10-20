import { ConnectionType, Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { writeAudit } from "@/lib/audit"
import { AppError } from "@/lib/errors"
import { hashPassword, verifyPassword } from "@/lib/password"
import { hasPermission, type Actor } from "@/lib/permissions"
import { accessibleLocationFilter, assertLocationAccess } from "@/lib/scope"
import { deriveDeviceStatus } from "@/server/domain"
import { getSettings } from "@/server/settings"

export async function listLocations(actor: Actor) {
  const rows = await prisma.restroomLocation.findMany({
    where: await accessibleLocationFilter(actor),
    include: { floor: { include: { building: true } }, supervisor: true, devices: true },
    orderBy: { name: "asc" },
  })
  return rows.map((location) => ({
    id: location.id,
    code: location.code,
    name: location.name,
    buildingId: location.floor.buildingId,
    buildingName: location.floor.building.name,
    floorId: location.floorId,
    floorName: location.floor.name,
    connectionType: location.connectionType,
    powerPreparation: location.powerPreparation,
    active: location.active,
    supervisorUserId: location.supervisorUserId,
    supervisorName: location.supervisor?.name ?? null,
    notes: location.notes,
    deviceCount: location.devices.length,
  }))
}

export async function saveLocation(
  actor: Actor,
  input: {
    id?: string
    floorId: string
    code: string
    name: string
    connectionType: ConnectionType
    powerPreparation: string
    active: boolean
    supervisorUserId?: string | null
    notes?: string | null
  },
  requestId?: string,
) {
  if (!hasPermission(actor, "locations.manage")) throw new AppError(403, "FORBIDDEN", "You do not have access to this action.")
  const data = {
    floorId: input.floorId,
    code: input.code.trim(),
    name: input.name.trim(),
    connectionType: input.connectionType,
    powerPreparation: input.powerPreparation.trim(),
    active: input.active,
    supervisorUserId: input.supervisorUserId || null,
    notes: input.notes?.trim() || null,
  }
  const location = input.id
    ? await prisma.restroomLocation.update({ where: { id: input.id }, data })
    : await prisma.restroomLocation.create({ data })
  await writeAudit({ actorId: actor.id, action: input.id ? "location.update" : "location.create", entityType: "RestroomLocation", entityId: location.id, after: data, requestId })
  return location.id
}

export async function listBuildings() {
  return prisma.building.findMany({ include: { floors: { orderBy: { level: "asc" } } }, orderBy: { name: "asc" } })
}

export async function listDevices(actor: Actor) {
  const now = new Date()
  const devices = await prisma.device.findMany({
    where: { location: await accessibleLocationFilter(actor) },
    include: { location: { include: { floor: { include: { building: true } } } } },
    orderBy: { code: "asc" },
  })
  const items = []
  for (const device of devices) {
    const status = deriveDeviceStatus({
      active: device.active,
      lastSeenAt: device.lastSeenAt,
      lastSyncError: device.lastSyncError,
      pendingOfflineCount: device.pendingOfflineCount,
      staleAfterSec: device.staleAfterSec,
      now,
    })
    if (status !== device.status) {
      await prisma.device.update({ where: { id: device.id }, data: { status } })
    }
    items.push({
      id: device.id,
      code: device.code,
      name: device.name,
      status,
      active: device.active,
      connectionType: device.connectionType,
      locationId: device.locationId,
      locationName: device.location.name,
      buildingName: device.location.floor.building.name,
      floorName: device.location.floor.name,
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
      lastSyncAt: device.lastSyncAt?.toISOString() ?? null,
      lastSyncError: device.lastSyncError,
      pendingOfflineCount: device.pendingOfflineCount,
      heartbeatIntervalSec: device.heartbeatIntervalSec,
      staleAfterSec: device.staleAfterSec,
      clockDriftMs: device.clockDriftMs,
      hasPin: Boolean(device.kioskPinHash),
      notes: device.notes,
    })
  }
  return items
}

export async function saveDevice(
  actor: Actor,
  input: {
    id?: string
    code: string
    name: string
    locationId: string
    connectionType: ConnectionType
    active: boolean
    heartbeatIntervalSec: number
    staleAfterSec: number
    notes?: string | null
    kioskPin?: string | null
    clearPin?: boolean
  },
  requestId?: string,
) {
  if (!hasPermission(actor, "devices.manage")) throw new AppError(403, "FORBIDDEN", "You do not have access to this action.")
  await assertLocationAccess(actor, input.locationId)
  const data: Prisma.DeviceUpdateInput = {
    code: input.code.trim(),
    name: input.name.trim(),
    location: { connect: { id: input.locationId } },
    connectionType: input.connectionType,
    active: input.active,
    heartbeatIntervalSec: input.heartbeatIntervalSec,
    staleAfterSec: input.staleAfterSec,
    notes: input.notes?.trim() || null,
    deactivatedAt: input.active ? null : new Date(),
    activatedAt: input.active ? new Date() : undefined,
    status: input.active ? undefined : "INACTIVE",
  }
  if (input.clearPin) data.kioskPinHash = null
  if (input.kioskPin) data.kioskPinHash = await hashPassword(input.kioskPin)
  const device = input.id
    ? await prisma.device.update({ where: { id: input.id }, data })
    : await prisma.device.create({
        data: {
          code: input.code.trim(),
          name: input.name.trim(),
          locationId: input.locationId,
          connectionType: input.connectionType,
          active: input.active,
          heartbeatIntervalSec: input.heartbeatIntervalSec,
          staleAfterSec: input.staleAfterSec,
          notes: input.notes?.trim() || null,
          kioskPinHash: input.kioskPin ? await hashPassword(input.kioskPin) : null,
          activatedAt: input.active ? new Date() : null,
          status: input.active ? "OFFLINE" : "INACTIVE",
        },
      })
  await writeAudit({
    actorId: actor.id,
    action: input.id ? "device.update" : "device.create",
    entityType: "Device",
    entityId: device.id,
    after: { code: device.code, locationId: input.locationId, active: input.active, pinChanged: Boolean(input.kioskPin || input.clearPin) },
    requestId,
  })
  return device.id
}

export async function deviceHistory(actor: Actor, id: string) {
  const device = await prisma.device.findUnique({ where: { id }, include: { location: true } })
  if (!device) throw new AppError(404, "NOT_FOUND", "Device not found.")
  await assertLocationAccess(actor, device.locationId)
  const heartbeats = await prisma.deviceHeartbeat.findMany({ where: { deviceId: id }, orderBy: { receivedAt: "desc" }, take: 100 })
  return heartbeats.map((beat) => ({
    id: beat.id,
    eventAt: beat.eventAt.toISOString(),
    receivedAt: beat.receivedAt.toISOString(),
    pendingCount: beat.pendingCount,
    clockDriftMs: beat.clockDriftMs,
    syncError: beat.syncError,
    appVersion: beat.appVersion,
  }))
}

export async function recordHeartbeat(input: { deviceCode: string; eventAt: string; pendingCount: number; syncError?: string | null; appVersion?: string | null }) {
  const device = await prisma.device.findUnique({ where: { code: input.deviceCode } })
  if (!device || !device.active) throw new AppError(404, "DEVICE", "This device is not active.")
  const eventAt = new Date(input.eventAt)
  const receivedAt = new Date()
  if (Number.isNaN(eventAt.getTime())) throw new AppError(400, "VALIDATION", "Heartbeat time is invalid.")
  const drift = eventAt.getTime() - receivedAt.getTime()
  const status = deriveDeviceStatus({
    active: true,
    lastSeenAt: receivedAt,
    lastSyncError: input.syncError || null,
    pendingOfflineCount: input.pendingCount,
    staleAfterSec: device.staleAfterSec,
    now: receivedAt,
  })
  await prisma.$transaction([
    prisma.deviceHeartbeat.create({
      data: { deviceId: device.id, eventAt, receivedAt, pendingCount: input.pendingCount, clockDriftMs: drift, syncError: input.syncError || null, appVersion: input.appVersion || null },
    }),
    prisma.device.update({
      where: { id: device.id },
      data: {
        lastSeenAt: receivedAt,
        pendingOfflineCount: input.pendingCount,
        clockDriftMs: drift,
        lastSyncError: input.syncError || null,
        appVersion: input.appVersion || null,
        status,
      },
    }),
  ])
  return { status, serverTime: receivedAt.toISOString() }
}

export async function kioskConfig(code: string) {
  const device = await prisma.device.findUnique({
    where: { code },
    include: { location: { include: { floor: { include: { building: true } } } } },
  })
  if (!device || !device.active) throw new AppError(404, "DEVICE", "This tablet is not registered.")
  const settings = await getSettings()
  const reasons = await prisma.feedbackReason.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } })
  return {
    deviceCode: device.code,
    locationName: device.location.name,
    buildingName: device.location.floor.building.name,
    floorName: device.location.floor.name,
    question: settings["survey.question"],
    thankYou: settings["survey.thankYou"],
    inactivitySeconds: Number(settings["survey.inactivitySeconds"]),
    negativeMaxRating: Number(settings["survey.negativeMaxRating"]),
    heartbeatIntervalSec: device.heartbeatIntervalSec,
    reasons: reasons.map((reason) => ({
      code: reason.code,
      label: reason.label,
      allowFreeText: reason.allowFreeText,
      freeTextRequired: reason.freeTextRequired,
    })),
  }
}

export async function unlockKiosk(code: string, pin: string) {
  const device = await prisma.device.findUnique({ where: { code } })
  if (!device?.kioskPinHash) throw new AppError(403, "FORBIDDEN", "Staff access is not configured on this tablet.")
  const valid = await verifyPassword(pin, device.kioskPinHash)
  if (!valid) throw new AppError(403, "FORBIDDEN", "Incorrect PIN.")
  return { ok: true }
}
