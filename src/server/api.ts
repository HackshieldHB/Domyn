import { z } from "zod"
import { prisma } from "@/lib/db"
import { AppError } from "@/lib/errors"
import { jsonOk, readJson } from "@/lib/http"
import type { SessionUser } from "@/lib/permissions"
import { annotateDecision, listAudit, listDecisions, listNotifications, listRoles, listUsers, saveUser, settingsView, updateRolePermissions, updateSetting } from "@/server/admin"
import { deviceHistory, listBuildings, listDevices, listLocations, saveDevice, saveLocation } from "@/server/assets"
import { commentOnTicket, getTicket, listTickets, reassignTicket, setTicketPriority, transitionTicket } from "@/server/complaints"
import { dashboard } from "@/server/dashboard"
import { listFeedback } from "@/server/feedback"
import { dispatchNotification } from "@/server/notifications"
import { exportReport, reportCatalog, type ReportType } from "@/server/reports"
import { listSla, runSlaSweep, saveSlaConfig } from "@/server/sla"
import {
  correctCheckIn,
  createAssignment,
  createCheckIn,
  importAssignments,
  listCheckIns,
  listStaff,
  recordAbsence,
  recordReplacement,
  saveStaff,
  schedule,
} from "@/server/workforce"
import type { TicketStatus } from "@prisma/client"

export async function dispatch(method: string, parts: string[], request: Request, user: SessionUser) {
  const url = new URL(request.url)
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 25))
  const q = url.searchParams.get("q") || undefined
  const [root, id, action] = parts

  if (method === "GET" && root === "bootstrap") return jsonOk(await bootstrap(user))
  if (method === "GET" && root === "dashboard") {
    allow(user, "dashboard.view")
    return jsonOk(await dashboard(user, filters(url)))
  }
  if (method === "GET" && root === "feedback") {
    allow(user, "feedback.view")
    return jsonOk(await listFeedback(user, { ...filters(url), rating: numberOrUndefined(url, "rating"), page, pageSize, q }))
  }
  if (method === "GET" && root === "tickets" && !id) {
    allow(user, "tickets.view")
    return jsonOk(await listTickets(user, { ...filters(url), page, pageSize, q }))
  }
  if (method === "GET" && root === "tickets" && id && !action) {
    allow(user, "tickets.view")
    return jsonOk(await getTicket(user, id))
  }
  if (method === "POST" && root === "tickets" && id && action === "transition") {
    const body = z.object({ to: z.enum(["NEW", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"]), note: z.string().max(1000).optional() }).parse(await readJson(request))
    return jsonOk(await transitionTicket(user, id, body.to as TicketStatus, body.note ?? null, request.headers.get("x-request-id") ?? undefined))
  }
  if (method === "POST" && root === "tickets" && id && action === "comments") {
    const body = z.object({ body: z.string().trim().min(1).max(2000) }).parse(await readJson(request))
    return jsonOk(await commentOnTicket(user, id, body.body, request.headers.get("x-request-id") ?? undefined))
  }
  if (method === "POST" && root === "tickets" && id && action === "assign") {
    const body = z.object({ staffId: z.string(), reason: z.string().trim().min(1).max(500) }).parse(await readJson(request))
    return jsonOk(await reassignTicket(user, id, body.staffId, body.reason, request.headers.get("x-request-id") ?? undefined))
  }
  if (method === "POST" && root === "tickets" && id && action === "priority") {
    const body = z.object({ priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]) }).parse(await readJson(request))
    return jsonOk(await setTicketPriority(user, id, body.priority, request.headers.get("x-request-id") ?? undefined))
  }
  if (method === "GET" && root === "staff") {
    allow(user, "staff.view")
    return jsonOk(await listStaff(user, q, page, pageSize))
  }
  if (method === "POST" && root === "staff") {
    const body = z.object({
      id: z.string().optional(),
      employeeCode: z.string().min(1),
      name: z.string().min(1),
      phone: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      designation: z.string().min(1),
      active: z.boolean(),
      locationIds: z.array(z.string()),
    }).parse(await readJson(request))
    return jsonOk({ id: await saveStaff(user, body, request.headers.get("x-request-id") ?? undefined) })
  }
  if (method === "GET" && root === "schedule") {
    allow(user, "shifts.view")
    const from = url.searchParams.get("from")
    const to = url.searchParams.get("to")
    if (!from || !to) throw new AppError(400, "VALIDATION", "Choose a start and end date.")
    return jsonOk(await schedule(user, from, to))
  }
  if (method === "POST" && root === "assignments" && !id) {
    const body = z.object({ staffId: z.string(), locationId: z.string(), shiftId: z.string(), workDate: z.string(), notes: z.string().nullable().optional() }).parse(await readJson(request))
    return jsonOk({ id: await createAssignment(user, body, request.headers.get("x-request-id") ?? undefined) })
  }
  if (method === "POST" && root === "assignments" && id === "import") {
    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof File)) throw new AppError(400, "VALIDATION", "Choose an Excel or CSV file.")
    return jsonOk(await importAssignments(user, file.name, new Uint8Array(await file.arrayBuffer()), request.headers.get("x-request-id") ?? undefined))
  }
  if (method === "POST" && root === "absences") {
    const body = z.object({ staffId: z.string(), type: z.enum(["SICK", "PERMISSION", "ABSENCE", "OTHER"]), startAt: z.string(), endAt: z.string(), notes: z.string().nullable().optional() }).parse(await readJson(request))
    return jsonOk({ id: await recordAbsence(user, body, request.headers.get("x-request-id") ?? undefined) })
  }
  if (method === "POST" && root === "replacements") {
    const body = z.object({
      absenceId: z.string().nullable().optional(),
      originalStaffId: z.string(),
      replacementStaffId: z.string(),
      locationId: z.string(),
      reason: z.string().min(1),
      effectiveFrom: z.string(),
      effectiveTo: z.string(),
    }).parse(await readJson(request))
    return jsonOk({ id: await recordReplacement(user, body, request.headers.get("x-request-id") ?? undefined) })
  }
  if (method === "GET" && root === "checkins") {
    allow(user, "checkin.view")
    return jsonOk(await listCheckIns(user, { ...filters(url), page, pageSize }))
  }
  if (method === "POST" && root === "checkins" && !id) {
    const body = z.object({
      staffId: z.string().nullable().optional(),
      locationId: z.string(),
      method: z.enum(["TABLET", "MOBILE", "MANUAL"]),
      notes: z.string().nullable().optional(),
      checkedInAt: z.string().nullable().optional(),
    }).parse(await readJson(request))
    return jsonOk(await createCheckIn(user, body, request.headers.get("x-request-id") ?? undefined))
  }
  if (method === "POST" && root === "checkins" && id && action === "correct") {
    const body = z.object({ reason: z.string().min(1), notes: z.string().nullable().optional() }).parse(await readJson(request))
    await correctCheckIn(user, id, body.reason, body.notes ?? null, request.headers.get("x-request-id") ?? undefined)
    return jsonOk({ id })
  }
  if (method === "GET" && root === "locations") {
    allow(user, "locations.view")
    return jsonOk(await listLocations(user))
  }
  if (method === "POST" && root === "locations") {
    const body = z.object({
      id: z.string().optional(),
      floorId: z.string(),
      code: z.string().min(1),
      name: z.string().min(1),
      connectionType: z.enum(["WIFI", "CELLULAR"]),
      powerPreparation: z.string().min(1),
      active: z.boolean(),
      supervisorUserId: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    }).parse(await readJson(request))
    return jsonOk({ id: await saveLocation(user, body, request.headers.get("x-request-id") ?? undefined) })
  }
  if (method === "GET" && root === "buildings") return jsonOk(await listBuildings())
  if (method === "GET" && root === "devices" && !id) {
    allow(user, "devices.view")
    return jsonOk(await listDevices(user))
  }
  if (method === "POST" && root === "devices") {
    const body = z.object({
      id: z.string().optional(),
      code: z.string().min(1),
      name: z.string().min(1),
      locationId: z.string(),
      connectionType: z.enum(["WIFI", "CELLULAR"]),
      active: z.boolean(),
      heartbeatIntervalSec: z.number().int().positive(),
      staleAfterSec: z.number().int().positive(),
      notes: z.string().nullable().optional(),
      kioskPin: z.string().min(4).nullable().optional(),
      clearPin: z.boolean().optional(),
    }).parse(await readJson(request))
    return jsonOk({ id: await saveDevice(user, body, request.headers.get("x-request-id") ?? undefined) })
  }
  if (method === "GET" && root === "devices" && id && action === "heartbeats") {
    allow(user, "devices.view")
    return jsonOk(await deviceHistory(user, id))
  }
  if (method === "GET" && root === "sla") {
    allow(user, "sla.view")
    return jsonOk(await listSla(user))
  }
  if (method === "POST" && root === "sla" && !id) {
    const body = slaBody.parse(await readJson(request))
    return jsonOk({ id: await saveSlaConfig(user, body) })
  }
  if (method === "POST" && root === "sla" && id === "run") {
    allow(user, "sla.manage")
    return jsonOk(await runSlaSweep(user))
  }
  if (method === "GET" && root === "notifications") {
    return jsonOk(await listNotifications(user, page, pageSize))
  }
  if (method === "POST" && root === "notifications" && id && action === "retry") {
    allow(user, "notifications.retry")
    await prisma.notification.update({ where: { id }, data: { status: "PENDING" } })
    const result = await dispatchNotification(id)
    return jsonOk({ id, status: result?.status ?? "FAILED", simulated: result?.mode === "SANDBOX" })
  }
  if (method === "GET" && root === "reports" && !id) {
    allow(user, "reports.view")
    return jsonOk(reportCatalog())
  }
  if (method === "GET" && root === "reports" && id && action === "export") {
    const result = await exportReport(user, id as ReportType, { from: url.searchParams.get("from") || undefined, to: url.searchParams.get("to") || undefined, locationId: url.searchParams.get("locationId") || undefined })
    return new Response(new Uint8Array(result.buffer), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${result.filename}"`,
      },
    })
  }
  if (method === "GET" && root === "users") return jsonOk(await listUsers(user))
  if (method === "POST" && root === "users") {
    const body = z.object({
      id: z.string().optional(),
      name: z.string().min(1),
      email: z.string().email(),
      roleKey: z.string(),
      active: z.boolean(),
      phone: z.string().nullable().optional(),
      password: z.string().nullable().optional(),
      staffId: z.string().nullable().optional(),
      buildingIds: z.array(z.string()),
    }).parse(await readJson(request))
    return jsonOk({ id: await saveUser(user, body, request.headers.get("x-request-id") ?? undefined) })
  }
  if (method === "GET" && root === "roles") {
    allow(user, "users.manage")
    return jsonOk(await listRoles())
  }
  if (method === "PUT" && root === "roles" && id) {
    const body = z.object({ permissions: z.array(z.string()) }).parse(await readJson(request))
    await updateRolePermissions(user, id, body.permissions, request.headers.get("x-request-id") ?? undefined)
    return jsonOk({ key: id })
  }
  if (method === "GET" && root === "audit") return jsonOk(await listAudit(user, page, pageSize, url.searchParams.get("entityType") || undefined))
  if (method === "GET" && root === "settings") {
    allow(user, "settings.manage")
    return jsonOk(await settingsView())
  }
  if (method === "PUT" && root === "settings" && id) {
    const body = z.object({ value: z.unknown() }).parse(await readJson(request))
    await updateSetting(user, decodeURIComponent(id), body.value, request.headers.get("x-request-id") ?? undefined)
    return jsonOk({ key: id })
  }
  if (method === "GET" && root === "decisions") {
    allow(user, "decisions.view")
    return jsonOk(await listDecisions())
  }
  if (method === "POST" && root === "decisions" && id) {
    const body = z.object({ note: z.string().min(1), status: z.enum(["PENDING", "PROVISIONAL", "APPROVED", "REJECTED"]).optional() }).parse(await readJson(request))
    await annotateDecision(user, id, body.note, body.status)
    return jsonOk({ id })
  }
  if (method === "GET" && root === "reasons") {
    allow(user, "settings.manage")
    return jsonOk(await prisma.feedbackReason.findMany({ orderBy: { sortOrder: "asc" } }))
  }
  if (method === "POST" && root === "reasons") {
    allow(user, "settings.manage")
    const body = z.object({
      id: z.string().optional(),
      code: z.string().min(1),
      label: z.string().min(1),
      active: z.boolean(),
      sortOrder: z.number().int(),
      allowFreeText: z.boolean(),
      freeTextRequired: z.boolean(),
    }).parse(await readJson(request))
    const row = body.id
      ? await prisma.feedbackReason.update({ where: { id: body.id }, data: body })
      : await prisma.feedbackReason.create({ data: body })
    return jsonOk(row)
  }
  throw new AppError(404, "NOT_FOUND", "Unknown API route.")
}

function allow(user: SessionUser, permission: string) {
  if (!user.permissions.includes(permission)) throw new AppError(403, "FORBIDDEN", "You do not have access to this action.")
}

function categoryOf(value: string | undefined): "MALE" | "FEMALE" | undefined {
  return value === "MALE" || value === "FEMALE" ? value : undefined
}

function filters(url: URL) {
  const get = (key: string) => url.searchParams.get(key) || undefined
  return {
    from: get("from"),
    to: get("to"),
    buildingId: get("buildingId"),
    locationId: get("locationId"),
    category: categoryOf(get("category")),
    deviceId: get("deviceId"),
    status: get("status"),
    reasonId: get("reasonId"),
    staffId: get("staffId"),
  }
}

function numberOrUndefined(url: URL, key: string) {
  const value = url.searchParams.get(key)
  if (!value) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

const slaBody = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).nullable().optional(),
  locationId: z.string().nullable().optional(),
  reasonId: z.string().nullable().optional(),
  responseMinutes: z.number().int().nullable().optional(),
  progressMinutes: z.number().int().nullable().optional(),
  resolutionMinutes: z.number().int().nullable().optional(),
  graceMinutes: z.number().int().min(0),
  escalationUserId: z.string().nullable().optional(),
  active: z.boolean(),
  notes: z.string().nullable().optional(),
})

async function bootstrap(user: SessionUser) {
  const [buildings, locations, staff, shifts, reasons] = await Promise.all([
    prisma.building.findMany({ include: { floors: { orderBy: { level: "asc" } } }, orderBy: { name: "asc" } }),
    prisma.restroomLocation.findMany({ orderBy: { name: "asc" } }),
    prisma.staff.findMany({ where: { active: true }, select: { id: true, name: true, employeeCode: true }, orderBy: { name: "asc" } }),
    prisma.shift.findMany({ where: { active: true }, orderBy: { startMinute: "asc" } }),
    prisma.feedbackReason.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ])
  return {
    user: { id: user.id, name: user.name, email: user.email, roleKey: user.roleKey, roleName: user.roleName, permissions: user.permissions, staffId: user.staffId },
    buildings,
    locations,
    staff,
    shifts,
    reasons,
  }
}
