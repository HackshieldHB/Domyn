import ExcelJS from "exceljs"
import { AbsenceType, CheckInMethod, Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { writeAudit } from "@/lib/audit"
import { AppError } from "@/lib/errors"
import { hasPermission, type Actor } from "@/lib/permissions"
import { maskPhone, shiftsOverlap, CHECK_IN_MEANING } from "@/server/domain"
import { assertLocationAccess, accessibleLocationFilter } from "@/lib/scope"
import { addDays, eachDate, localDateString, localDayRange, span, workDate } from "@/lib/time"
import { routeLocation } from "@/server/routing"
import { getSettings } from "@/server/settings"

export async function listStaff(actor: Actor, query: string | undefined, page: number, pageSize: number) {
  const canManage = hasPermission(actor, "staff.manage")
  const where: Prisma.StaffWhereInput = {
    AND: [
      query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { employeeCode: { contains: query, mode: "insensitive" } },
            ],
          }
        : {},
    ],
  }
  const [total, rows] = await Promise.all([
    prisma.staff.count({ where }),
    prisma.staff.findMany({
      where,
      include: { coverage: { include: { location: true } }, user: { select: { id: true, email: true } } },
      orderBy: { employeeCode: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])
  return {
    page,
    pageSize,
    total,
    items: rows.map((staff) => ({
      id: staff.id,
      employeeCode: staff.employeeCode,
      name: staff.name,
      designation: staff.designation,
      active: staff.active,
      phone: maskPhone(staff.phone, canManage || actor.staffId === staff.id),
      email: canManage ? staff.email : null,
      userEmail: staff.user?.email ?? null,
      coverage: staff.coverage.map((item) => ({
        id: item.id,
        locationId: item.locationId,
        locationName: item.location.name,
        effectiveFrom: item.effectiveFrom.toISOString(),
        effectiveTo: item.effectiveTo?.toISOString() ?? null,
      })),
    })),
  }
}

export async function saveStaff(
  actor: Actor,
  input: {
    id?: string
    employeeCode: string
    name: string
    phone?: string | null
    email?: string | null
    designation: string
    active: boolean
    locationIds: string[]
  },
  requestId?: string,
) {
  if (!hasPermission(actor, "staff.manage")) throw new AppError(403, "FORBIDDEN", "You do not have access to this action.")
  for (const locationId of input.locationIds) await assertLocationAccess(actor, locationId)
  const data = {
    employeeCode: input.employeeCode.trim(),
    name: input.name.trim(),
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    designation: input.designation.trim(),
    active: input.active,
  }
  const staff = input.id
    ? await prisma.staff.update({ where: { id: input.id }, data })
    : await prisma.staff.create({ data })
  if (input.id) {
    await prisma.staffAreaCoverage.deleteMany({ where: { staffId: staff.id, effectiveTo: null } })
  }
  if (input.locationIds.length) {
    await prisma.staffAreaCoverage.createMany({
      data: input.locationIds.map((locationId) => ({
        staffId: staff.id,
        locationId,
        effectiveFrom: new Date(),
      })),
    })
  }
  await writeAudit({
    actorId: actor.id,
    action: input.id ? "staff.update" : "staff.create",
    entityType: "Staff",
    entityId: staff.id,
    after: { ...data, phone: maskPhone(data.phone, false), locationIds: input.locationIds },
    requestId,
  })
  return staff.id
}

export async function schedule(actor: Actor, from: string, to: string) {
  const settings = await getSettings()
  const dates = eachDate(from, to)
  const locationWhere = await accessibleLocationFilter(actor)
  const [assignments, shifts, locations, absences, replacements] = await Promise.all([
    prisma.plannedAssignment.findMany({
      where: { workDate: { gte: workDate(from), lte: workDate(to) }, location: locationWhere },
      include: { staff: true, shift: true, location: { include: { floor: { include: { building: true } } } } },
      orderBy: [{ workDate: "asc" }, { shift: { startMinute: "asc" } }],
    }),
    prisma.shift.findMany({ where: { active: true }, orderBy: { startMinute: "asc" } }),
    prisma.restroomLocation.findMany({ where: { AND: [locationWhere, { active: true }] }, orderBy: { name: "asc" } }),
    prisma.staffAbsence.findMany({
      where: { startAt: { lt: span(from, to, settings["app.timezone"]).end }, endAt: { gt: span(from, to, settings["app.timezone"]).start } },
      include: { staff: true },
    }),
    prisma.staffReplacement.findMany({
      where: {
        location: locationWhere,
        effectiveFrom: { lt: span(from, to, settings["app.timezone"]).end },
        effectiveTo: { gt: span(from, to, settings["app.timezone"]).start },
      },
      include: { originalStaff: true, replacementStaff: true, location: true },
    }),
  ])
  const gaps = []
  for (const date of dates) {
    for (const location of locations) {
      for (const shift of shifts) {
        const covered = assignments.some(
          (item) =>
            item.locationId === location.id &&
            item.shiftId === shift.id &&
            item.workDate.toISOString().slice(0, 10) === date,
        )
        if (!covered) gaps.push({ date, locationId: location.id, locationName: location.name, shiftId: shift.id, shiftName: shift.name })
      }
    }
  }
  return {
    timeZone: settings["app.timezone"],
    from,
    to,
    shifts: shifts.map((shift) => ({ id: shift.id, code: shift.code, name: shift.name, startMinute: shift.startMinute, endMinute: shift.endMinute })),
    assignments: assignments.map((item) => ({
      id: item.id,
      date: item.workDate.toISOString().slice(0, 10),
      staffId: item.staffId,
      staffName: item.staff.name,
      employeeCode: item.staff.employeeCode,
      locationId: item.locationId,
      locationName: item.location.name,
      buildingName: item.location.floor.building.name,
      shiftId: item.shiftId,
      shiftName: item.shift.name,
      notes: item.notes,
    })),
    gaps: gaps.slice(0, 200),
    gapCount: gaps.length,
    absences: absences.map((item) => ({
      id: item.id,
      staffId: item.staffId,
      staffName: item.staff.name,
      type: item.type,
      startAt: item.startAt.toISOString(),
      endAt: item.endAt.toISOString(),
      notes: item.notes,
    })),
    replacements: replacements.map((item) => ({
      id: item.id,
      originalStaffName: item.originalStaff.name,
      replacementStaffId: item.replacementStaffId,
      replacementStaffName: item.replacementStaff.name,
      locationId: item.locationId,
      locationName: item.location.name,
      reason: item.reason,
      effectiveFrom: item.effectiveFrom.toISOString(),
      effectiveTo: item.effectiveTo.toISOString(),
    })),
  }
}

export async function createAssignment(
  actor: Actor,
  input: { staffId: string; locationId: string; shiftId: string; workDate: string; notes?: string | null },
  requestId?: string,
) {
  if (!hasPermission(actor, "shifts.manage")) throw new AppError(403, "FORBIDDEN", "You do not have access to this action.")
  await assertLocationAccess(actor, input.locationId)
  const [staff, shift, location] = await Promise.all([
    prisma.staff.findUnique({ where: { id: input.staffId } }),
    prisma.shift.findUnique({ where: { id: input.shiftId } }),
    prisma.restroomLocation.findUnique({ where: { id: input.locationId } }),
  ])
  if (!staff?.active || !shift?.active || !location?.active) throw new AppError(400, "VALIDATION", "Choose an active staff member, shift, and location.")
  const sameDay = await prisma.plannedAssignment.findMany({
    where: { staffId: staff.id, workDate: workDate(input.workDate) },
    include: { shift: true },
  })
  const conflict = sameDay.find((item) => item.shiftId !== shift.id && shiftsOverlap(item.shift, shift))
  if (conflict) throw new AppError(409, "CONFLICT", "This staff member already has an overlapping shift on that date.")
  try {
    const created = await prisma.plannedAssignment.create({
      data: {
        staffId: staff.id,
        locationId: location.id,
        shiftId: shift.id,
        workDate: workDate(input.workDate),
        notes: input.notes?.trim() || null,
        createdById: actor.id,
      },
    })
    await writeAudit({
      actorId: actor.id,
      action: "assignment.create",
      entityType: "PlannedAssignment",
      entityId: created.id,
      after: input,
      requestId,
    })
    return created.id
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(409, "CONFLICT", "That assignment already exists.")
    }
    throw error
  }
}

export async function importAssignments(actor: Actor, fileName: string, bytes: Uint8Array, requestId?: string) {
  if (!hasPermission(actor, "shifts.manage")) throw new AppError(403, "FORBIDDEN", "You do not have access to this action.")
  const rows = await readRows(fileName, bytes)
  const errors: Array<{ row: number; message: string }> = []
  let successCount = 0
  for (const [index, row] of rows.entries()) {
    try {
      const staff = await prisma.staff.findUnique({ where: { employeeCode: row.employeeCode } })
      const location = await prisma.restroomLocation.findUnique({ where: { code: row.locationCode } })
      const shift = await prisma.shift.findUnique({ where: { code: row.shiftCode } })
      if (!staff || !location || !shift) throw new AppError(400, "VALIDATION", "Staff, location, or shift code was not found.")
      await createAssignment(actor, { staffId: staff.id, locationId: location.id, shiftId: shift.id, workDate: row.workDate, notes: row.notes }, requestId)
      successCount += 1
    } catch (error) {
      errors.push({ row: index + 2, message: error instanceof Error ? error.message : "Row failed." })
    }
  }
  const batch = await prisma.importBatch.create({
    data: { type: "assignments", fileName, createdById: actor.id, successCount, errorCount: errors.length, errors },
  })
  return { id: batch.id, successCount, errorCount: errors.length, errors }
}

async function readRows(fileName: string, bytes: Uint8Array) {
  if (fileName.toLowerCase().endsWith(".csv")) {
    const text = new TextDecoder().decode(bytes)
    const [header, ...lines] = text.split(/\r?\n/).filter((line) => line.trim())
    const columns = header.split(",").map((item) => item.trim())
    return lines.map((line) => toRow(columns, line.split(",").map((item) => item.trim())))
  }
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new AppError(400, "VALIDATION", "The workbook has no worksheet.")
  const headers = (sheet.getRow(1).values as Array<string | undefined>).slice(1).map((value) => String(value ?? "").trim())
  const rows: Array<ReturnType<typeof toRow>> = []
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const values = (row.values as Array<unknown>).slice(1).map((value) => String(value ?? "").trim())
    rows.push(toRow(headers, values))
  })
  return rows
}

function toRow(headers: string[], values: string[]) {
  const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))
  const workDateValue = record.workDate
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDateValue)) throw new AppError(400, "VALIDATION", "workDate must use YYYY-MM-DD.")
  return {
    employeeCode: record.employeeCode,
    locationCode: record.locationCode,
    shiftCode: record.shiftCode,
    workDate: workDateValue,
    notes: record.notes || null,
  }
}

export async function recordAbsence(
  actor: Actor,
  input: { staffId: string; type: AbsenceType; startAt: string; endAt: string; notes?: string | null },
  requestId?: string,
) {
  if (!hasPermission(actor, "shifts.manage")) throw new AppError(403, "FORBIDDEN", "You do not have access to this action.")
  const startAt = new Date(input.startAt)
  const endAt = new Date(input.endAt)
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
    throw new AppError(400, "VALIDATION", "Enter a valid absence period.")
  }
  const absence = await prisma.staffAbsence.create({
    data: { staffId: input.staffId, type: input.type, startAt, endAt, notes: input.notes?.trim() || null, recordedById: actor.id },
  })
  await writeAudit({ actorId: actor.id, action: "absence.create", entityType: "StaffAbsence", entityId: absence.id, after: input, requestId })
  return absence.id
}

export async function recordReplacement(
  actor: Actor,
  input: {
    absenceId?: string | null
    originalStaffId: string
    replacementStaffId: string
    locationId: string
    reason: string
    effectiveFrom: string
    effectiveTo: string
  },
  requestId?: string,
) {
  if (!hasPermission(actor, "shifts.manage")) throw new AppError(403, "FORBIDDEN", "You do not have access to this action.")
  if (input.originalStaffId === input.replacementStaffId) {
    throw new AppError(400, "VALIDATION", "Choose a different staff member as the replacement.")
  }
  await assertLocationAccess(actor, input.locationId)
  const effectiveFrom = new Date(input.effectiveFrom)
  const effectiveTo = new Date(input.effectiveTo)
  if (Number.isNaN(effectiveFrom.getTime()) || effectiveTo <= effectiveFrom) {
    throw new AppError(400, "VALIDATION", "Enter a valid replacement period.")
  }
  const plannedBefore = await prisma.plannedAssignment.count({ where: { staffId: input.originalStaffId, locationId: input.locationId } })
  const replacement = await prisma.staffReplacement.create({
    data: {
      absenceId: input.absenceId || null,
      originalStaffId: input.originalStaffId,
      replacementStaffId: input.replacementStaffId,
      locationId: input.locationId,
      reason: input.reason.trim(),
      effectiveFrom,
      effectiveTo,
      createdById: actor.id,
    },
  })
  const plannedAfter = await prisma.plannedAssignment.count({ where: { staffId: input.originalStaffId, locationId: input.locationId } })
  if (plannedBefore !== plannedAfter) throw new AppError(500, "INTERNAL", "Replacement must not change planned assignments.")
  await writeAudit({
    actorId: actor.id,
    action: "replacement.create",
    entityType: "StaffReplacement",
    entityId: replacement.id,
    reason: input.reason,
    after: { ...input, plannedAssignmentsUnchanged: true },
    requestId,
  })
  return replacement.id
}

export async function listCheckIns(actor: Actor, filters: { from?: string; to?: string; staffId?: string; locationId?: string; page: number; pageSize: number }) {
  const settings = await getSettings()
  const today = localDateString(new Date(), settings["app.timezone"])
  const range = span(filters.from || addDays(today, -6), filters.to || today, settings["app.timezone"])
  const where: Prisma.StaffCheckInWhereInput = {
    AND: [
      { checkedInAt: { gte: range.start, lt: range.end } },
      { location: await accessibleLocationFilter(actor) },
      filters.staffId ? { staffId: filters.staffId } : {},
      filters.locationId ? { locationId: filters.locationId } : {},
      actor.roleKey === "STAFF" && actor.staffId ? { staffId: actor.staffId } : {},
    ],
  }
  const [total, rows] = await Promise.all([
    prisma.staffCheckIn.count({ where }),
    prisma.staffCheckIn.findMany({
      where,
      include: { staff: true, location: true },
      orderBy: { checkedInAt: "desc" },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ])
  const missing = await missingCheckIns(actor, filters.to || today)
  return {
    meaning: CHECK_IN_MEANING,
    timeZone: settings["app.timezone"],
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    items: rows.map((item) => ({
      id: item.id,
      staffId: item.staffId,
      staffName: item.staff.name,
      employeeCode: item.staff.employeeCode,
      locationId: item.locationId,
      locationName: item.location.name,
      method: item.method,
      checkedInAt: item.checkedInAt.toISOString(),
      matchesAssignment: item.matchesAssignment,
      notes: item.notes,
      correctionReason: item.correctionReason,
      correctedAt: item.correctedAt?.toISOString() ?? null,
    })),
    missing,
  }
}

async function missingCheckIns(actor: Actor, date: string) {
  const settings = await getSettings()
  const range = localDayRange(date, settings["app.timezone"])
  const assignments = await prisma.plannedAssignment.findMany({
    where: { workDate: workDate(date), location: await accessibleLocationFilter(actor) },
    include: { staff: true, location: true, shift: true },
  })
  const checkIns = await prisma.staffCheckIn.findMany({
    where: { checkedInAt: { gte: range.start, lt: range.end } },
    select: { staffId: true, locationId: true },
  })
  const seen = new Set(checkIns.map((item) => `${item.staffId}:${item.locationId}`))
  return assignments
    .filter((item) => !seen.has(`${item.staffId}:${item.locationId}`))
    .slice(0, 50)
    .map((item) => ({
      staffName: item.staff.name,
      locationName: item.location.name,
      shiftName: item.shift.name,
      date,
    }))
}

export async function createCheckIn(
  actor: Actor,
  input: { staffId?: string | null; locationId: string; method: CheckInMethod; deviceId?: string | null; notes?: string | null; checkedInAt?: string | null },
  requestId?: string,
) {
  if (!hasPermission(actor, "checkin.create")) throw new AppError(403, "FORBIDDEN", "You do not have access to this action.")
  const staffId = actor.roleKey === "STAFF" ? actor.staffId : input.staffId
  if (!staffId) throw new AppError(400, "VALIDATION", "Choose the staff member who is checking in.")
  await assertLocationAccess(actor, input.locationId)
  const settings = await getSettings()
  const checkedInAt = input.checkedInAt ? new Date(input.checkedInAt) : new Date()
  const routing = await routeLocation(prisma, input.locationId, checkedInAt, settings["app.timezone"])
  const matchesAssignment = routing.expectedStaffIds.includes(staffId)
  const checkIn = await prisma.staffCheckIn.create({
    data: {
      staffId,
      locationId: input.locationId,
      method: input.method,
      deviceId: input.deviceId || null,
      checkedInAt,
      matchesAssignment,
      notes: input.notes?.trim() || null,
    },
  })
  await writeAudit({
    actorId: actor.id,
    action: "checkin.create",
    entityType: "StaffCheckIn",
    entityId: checkIn.id,
    after: { staffId, locationId: input.locationId, matchesAssignment, meaning: CHECK_IN_MEANING },
    requestId,
  })
  return { id: checkIn.id, matchesAssignment, meaning: CHECK_IN_MEANING }
}

export async function correctCheckIn(actor: Actor, id: string, reason: string, notes: string | null, requestId?: string) {
  if (!hasPermission(actor, "checkin.correct")) throw new AppError(403, "FORBIDDEN", "You do not have access to this action.")
  if (!reason.trim()) throw new AppError(400, "VALIDATION", "A correction reason is required.")
  const existing = await prisma.staffCheckIn.findUnique({ where: { id } })
  if (!existing) throw new AppError(404, "NOT_FOUND", "Check-in not found.")
  await assertLocationAccess(actor, existing.locationId)
  await prisma.staffCheckIn.update({
    where: { id },
    data: { notes: notes?.trim() || existing.notes, correctionReason: reason.trim(), correctedById: actor.id, correctedAt: new Date() },
  })
  await writeAudit({
    actorId: actor.id,
    action: "checkin.correct",
    entityType: "StaffCheckIn",
    entityId: id,
    before: { notes: existing.notes },
    after: { notes, correctionReason: reason },
    reason,
    requestId,
  })
}
