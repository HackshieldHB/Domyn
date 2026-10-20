import { hashPassword } from "../src/lib/password"
import { prisma } from "../src/lib/db"
import { permissionsForRole, PERMISSIONS } from "../src/lib/permissions"
import { addDays, localDateString, zonedTimeToUtc } from "../src/lib/time"
import { ingestSubmission } from "../src/server/feedback"
import { commentOnTicket, transitionTicket } from "../src/server/complaints"
import { workDate } from "../src/lib/time"
import { recordHeartbeat } from "../src/server/assets"

const PASSWORD = process.env.SEED_DEMO_PASSWORD || "ChangeMe-Dev-Only!"
const TIMEZONE = "Asia/Jakarta"

const LOCATIONS = [
  ["TLT", "GF", 0, "tlt-gf-starbucks", "TLT GF Starbucks", "WIFI", "Available"],
  ["TLT", "F6", 6, "tlt-f6", "TLT Floor 6", "WIFI", "Estimated 20 m cable"],
  ["TLT", "F7", 7, "tlt-f7", "TLT Floor 7", "CELLULAR", "Estimated 15 m cable"],
  ["TLT", "F8", 8, "tlt-f8", "TLT Floor 8", "CELLULAR", "Estimated 15 m cable"],
  ["TLT", "F31", 31, "tlt-f31", "TLT Floor 31", "WIFI", "Estimated 20 m cable"],
  ["TLT", "F38", 38, "tlt-f38", "TLT Floor 38", "WIFI", "Estimated 20 m cable"],
  ["TSO", "GF", 0, "tso-lobby-gf", "TSO Lobby GF", "WIFI", "Available"],
  ["TSO", "F10", 10, "tso-f10", "TSO Floor 10", "CELLULAR", "Available"],
  ["KOPI", "GF", 0, "kopi-oey", "Kopi Oey", "WIFI", "Estimated 10 m cable"],
] as const

const REASONS = [
  ["ODOR", "Unpleasant restroom odor.", false],
  ["FLOOR", "Wet or slippery floor.", false],
  ["TISSUE", "Tissue or toilet paper unavailable.", false],
  ["STAFF", "Staff not friendly.", false],
  ["TRASH", "Trash bin full.", false],
  ["OTHER", "Other issue.", true],
] as const

const DECISIONS = [
  ["D01", "Maximum two-page survey flow", "Use two pages: rating, then reasons only for ratings 1–3.", "Bu Effi / TLT"],
  ["D02", "Survey wording and Other-reason behavior", "Other is optional free text and is not required.", "Bu Effi / TLT"],
  ["D03", "One ticket per submission or per reason", "Development default is one ticket per submission.", "TLT operations"],
  ["D04", "SLA definitions and escalation", "No universal threshold is enforced. A 20-minute response example is stored inactive.", "TLT operations"],
  ["D05", "Fallback recipients and notification routing", "Location supervisor is the fallback recipient.", "TLT operations"],
  ["D06", "Final roles and area access", "Admin, Supervisor, Staff, and Management, with editable permissions.", "TLT"],
  ["D07", "Check-in method", "Tablet, mobile web, and manual correction are all available. Tablet is the provisional preference.", "TLT operations"],
  ["D08", "WhatsApp provider, templates, and cost", "Sandbox provider only. No message is sent to WhatsApp.", "TLT / vendor"],
  ["D09", "Management KPIs and report permissions", "Management can view and export. They cannot change operations.", "TLT management"],
  ["D10", "Hosting, SIM plans, and operating cost", "Not selected. Docker and environment variables are prepared.", "TLT IT"],
  ["D11", "Tablet model and specification", "Not selected. No model is hardcoded as approved.", "TLT procurement"],
  ["D12", "Power, Wi-Fi, and installation readiness", "Seeded from the proposed site table and editable by administrators.", "TLT facilities"],
  ["D13", "Retention, availability, backup, and recovery", "Not committed. No uptime or RPO/RTO figure is claimed.", "TLT IT"],
]

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_PRODUCTION !== "true") {
    throw new Error("Refusing to seed while NODE_ENV is production.")
  }
  const existing = await prisma.user.findUnique({ where: { email: "admin@domyn.local" } })
  if (existing) {
    console.log("Seed data already exists. Run npm run db:reset to rebuild the local database.")
    return
  }
  const passwordHash = await hashPassword(PASSWORD)
  const pinHash = await hashPassword("2468")

  for (const [key, description] of PERMISSIONS) {
    await prisma.permission.create({ data: { key, description } })
  }
  const permissions = await prisma.permission.findMany()
  const byKey = new Map(permissions.map((item) => [item.key, item.id]))
  const roleNames = [
    ["ADMIN", "Administrator", "Full system administration."],
    ["SUPERVISOR", "Supervisor", "Operational supervision for assigned areas."],
    ["STAFF", "Staff", "Assigned service tasks and presence check-in."],
    ["MANAGEMENT", "Management", "Dashboards, analytics, and authorized exports."],
  ] as const
  const roles = new Map<string, string>()
  for (const [key, name, description] of roleNames) {
    const role = await prisma.role.create({ data: { key, name, description } })
    roles.set(key, role.id)
    await prisma.rolePermission.createMany({
      data: permissionsForRole(key).map((permission) => ({ roleId: role.id, permissionId: byKey.get(permission)! })),
    })
  }

  const admin = await prisma.user.create({
    data: { name: "DOMYN Administrator", email: "admin@domyn.local", passwordHash, roleId: roles.get("ADMIN")!, phone: "+628110000001" },
  })
  const supervisor = await prisma.user.create({
    data: { name: "Farah Amelia", email: "supervisor@domyn.local", passwordHash, roleId: roles.get("SUPERVISOR")!, phone: "+628110000002" },
  })
  const staffUser = await prisma.user.create({
    data: { name: "Rina Hartono", email: "staff@domyn.local", passwordHash, roleId: roles.get("STAFF")!, phone: "+628110000101" },
  })
  await prisma.user.create({
    data: { name: "Management Viewer", email: "management@domyn.local", passwordHash, roleId: roles.get("MANAGEMENT")! },
  })

  const buildings = {
    TLT: await prisma.building.create({ data: { code: "TLT", name: "TLT" } }),
    TSO: await prisma.building.create({ data: { code: "TSO", name: "TSO" } }),
    KOPI: await prisma.building.create({ data: { code: "KOPI", name: "Kopi Oey" } }),
  }
  for (const building of Object.values(buildings)) {
    await prisma.userAreaAccess.create({ data: { userId: supervisor.id, buildingId: building.id } })
  }

  const locationIds: string[] = []
  for (const [buildingCode, floorCode, level, code, name, connection, power] of LOCATIONS) {
    const floor = await prisma.floor.create({
      data: { buildingId: buildings[buildingCode].id, code: floorCode, name: floorCode === "GF" ? "Ground floor" : `Floor ${level}`, level },
    })
    const location = await prisma.restroomLocation.create({
      data: {
        floorId: floor.id,
        code,
        name,
        connectionType: connection,
        powerPreparation: power,
        supervisorUserId: supervisor.id,
        notes: "Proposed installation location. Power and network readiness are not confirmed.",
      },
    })
    locationIds.push(location.id)
    await prisma.device.create({
      data: {
        code: `TAB-${code.toUpperCase()}`,
        name: `${name} tablet`,
        locationId: location.id,
        connectionType: connection,
        active: true,
        activatedAt: new Date(),
        heartbeatIntervalSec: 60,
        staleAfterSec: 180,
        kioskPinHash: pinHash,
        status: "OFFLINE",
        notes: "Initial proposed device. Tablet model is not an approved specification.",
      },
    })
  }

  for (const [index, [code, label, freeText]] of REASONS.entries()) {
    await prisma.feedbackReason.create({
      data: { code, label, sortOrder: index + 1, allowFreeText: freeText, freeTextRequired: false, active: true },
    })
  }

  const settings = [
    ["app.timezone", TIMEZONE, "Display timezone. Storage remains UTC."],
    ["app.dataLabel", "Development seed data", "Banner shown while demonstration records are loaded."],
    ["survey.question", "How satisfied are you with this restroom?", "Pending approval of the public wording."],
    ["survey.thankYou", "Thank you. Your feedback helps us improve this restroom.", "Pending approval."],
    ["survey.inactivitySeconds", 45, "Kiosk reset delay."],
    ["survey.negativeMaxRating", 3, "Ratings at or below this value can open a complaint."],
    ["ticket.policy", "PER_SUBMISSION", "Provisional development default, not an approved TLT rule."],
    ["ticket.groupingEnabled", false, "Grouping is off so every complaint stays separate."],
    ["ticket.groupingWindowMinutes", 60, "Used only if grouping is enabled."],
    ["sla.clock", "RECEIVED_AT", "Provisional clock. Offline delay does not start the response timer."],
    ["sla.delayedSyncMinutes", 10, "Flags a gap between event time and server receipt."],
    ["sla.escalationEnabled", false, "Escalation stays off until recipients and thresholds are approved."],
    ["device.defaultHeartbeatSec", 60, "Suggested heartbeat for new devices."],
    ["device.defaultStaleSec", 180, "Offline after this many seconds without a heartbeat."],
    ["security.sessionHours", 12, "Internal session length."],
    ["checkin.method", "TABLET", "Provisional check-in preference."],
  ] as const
  for (const [key, value, description] of settings) {
    await prisma.systemSetting.create({ data: { key, value, description, provisional: key !== "security.sessionHours" && key !== "app.dataLabel", updatedById: admin.id } })
  }

  for (const [code, topic, proposedDefault, owner] of DECISIONS) {
    const decision = await prisma.decision.create({
      data: { code, topic, status: "PENDING", proposedDefault, owner, notes: "Recorded from the proposed requirements. This is not an approval." },
    })
    await prisma.decisionHistory.create({
      data: { decisionId: decision.id, status: "PENDING", note: "Opened from proposed requirements v0.2.", actorId: admin.id },
    })
  }

  await prisma.slaConfiguration.create({
    data: {
      name: "Example response window — not approved",
      responseMinutes: 20,
      graceMinutes: 0,
      active: false,
      provisional: true,
      escalationUserId: supervisor.id,
      notes: "The 15–20 minute figure came from an operational discussion. It is not an approved SLA, not a resolution deadline, and it is inactive.",
    },
  })

  const people = [
    ["S-1001", "Rina Hartono", "Housekeeping Attendant", "+628110000101", staffUser.id],
    ["S-1002", "Budi Santoso", "Housekeeping Attendant", "+628110000102", null],
    ["S-1003", "Sari Wijaya", "Housekeeping Attendant", "+628110000103", null],
    ["S-1004", "Agus Pratama", "Housekeeping Attendant", "+628110000104", null],
    ["S-1005", "Maya Putri", "Housekeeping Attendant", "+628110000105", null],
    ["S-1006", "Dimas Nugroho", "Housekeeping Attendant", "+628110000106", null],
    ["S-2001", "Lina Kusuma", "Team Leader", "+628110000201", null],
    ["S-2002", "Hendra Wijaya", "Team Leader", "+628110000202", null],
    ["S-3001", "Farah Amelia", "Housekeeping Supervisor", "+628110000002", supervisor.id],
  ] as const
  const staffIds: string[] = []
  for (const [employeeCode, name, designation, phone, userId] of people) {
    const staff = await prisma.staff.create({ data: { employeeCode, name, designation, phone, userId, active: true } })
    staffIds.push(staff.id)
    const coverage = staffIds.length <= 6 ? locationIds.slice((staffIds.length - 1) % 3, ((staffIds.length - 1) % 3) + 3) : locationIds
    await prisma.staffAreaCoverage.createMany({
      data: coverage.map((locationId) => ({ staffId: staff.id, locationId, effectiveFrom: new Date(Date.now() - 30 * 86400000) })),
    })
  }

  const morning = await prisma.shift.create({ data: { code: "MORNING", name: "Morning", startMinute: 6 * 60, endMinute: 14 * 60 } })
  const afternoon = await prisma.shift.create({ data: { code: "AFTERNOON", name: "Afternoon", startMinute: 14 * 60, endMinute: 22 * 60 } })
  await prisma.shift.create({ data: { code: "NIGHT", name: "Night", startMinute: 22 * 60, endMinute: 6 * 60 } })

  const today = localDateString(new Date(), TIMEZONE)
  const attendants = staffIds.slice(0, 6)
  for (let offset = -14; offset <= 7; offset += 1) {
    const date = addDays(today, offset)
    for (const [index, locationId] of locationIds.entries()) {
      await prisma.plannedAssignment.create({
        data: { staffId: attendants[index % attendants.length], locationId, shiftId: morning.id, workDate: workDate(date), createdById: admin.id },
      })
      if (locationId !== locationIds[4]) {
        await prisma.plannedAssignment.create({
          data: { staffId: attendants[(index + 2) % attendants.length], locationId, shiftId: afternoon.id, workDate: workDate(date), createdById: admin.id },
        })
      }
    }
  }

  const absence = await prisma.staffAbsence.create({
    data: {
      staffId: staffIds[0],
      type: "SICK",
      startAt: zonedTimeToUtc(...parts(today), 0, 0, TIMEZONE),
      endAt: zonedTimeToUtc(...parts(addDays(today, 1)), 0, 0, TIMEZONE),
      notes: "Reported sick before the morning shift.",
      recordedById: supervisor.id,
    },
  })
  await prisma.staffReplacement.create({
    data: {
      absenceId: absence.id,
      originalStaffId: staffIds[0],
      replacementStaffId: staffIds[3],
      locationId: locationIds[0],
      reason: "Sick leave cover for the Starbucks restroom.",
      effectiveFrom: zonedTimeToUtc(...parts(today), 6, 0, TIMEZONE),
      effectiveTo: zonedTimeToUtc(...parts(today), 14, 0, TIMEZONE),
      createdById: supervisor.id,
    },
  })

  const devices = await prisma.device.findMany({ orderBy: { code: "asc" } })
  const rand = mulberry32(20261020)
  const reasonPool = ["ODOR", "FLOOR", "TISSUE", "STAFF", "TRASH", "OTHER"]
  for (let index = 0; index < 42; index += 1) {
    const device = devices[index % devices.length]
    const day = addDays(today, -Math.floor(rand() * 14))
    const hour = 7 + Math.floor(rand() * 6)
    const minute = Math.floor(rand() * 60)
    const [year, month, date] = parts(day)
    const eventAt = zonedTimeToUtc(year, month, date, hour, minute, TIMEZONE)
    const roll = rand()
    const rating = roll < 0.12 ? 1 : roll < 0.28 ? 2 : roll < 0.42 ? 3 : roll < 0.7 ? 4 : 5
    const reasonCodes = rating <= 3 ? uniqueReasons(reasonPool, 1 + Math.floor(rand() * 2), rand) : []
    const delayed = index % 9 === 0
    await ingestSubmission({
      deviceCode: device.code,
      clientSubmissionId: crypto.randomUUID(),
      restroomCategory: index % 2 === 0 ? "MALE" : "FEMALE",
      rating,
      reasonCodes,
      otherText: reasonCodes.includes("OTHER") ? "Soap dispenser is empty." : null,
      eventAt,
      receivedAt: new Date(eventAt.getTime() + (delayed ? 2 * 60 * 60 * 1000 : 20 * 1000)),
    })
  }

  const actor = { id: admin.id, roleKey: "ADMIN", permissions: permissionsForRole("ADMIN"), staffId: null, areaAccess: [] }
  const tickets = await prisma.complaintTicket.findMany({ orderBy: { receivedAt: "asc" } })
  for (const [index, ticket] of tickets.entries()) {
    if (ticket.status !== "ASSIGNED" || index % 4 === 0) continue
    await transitionTicket(actor, ticket.id, "IN_PROGRESS", null)
    if (index % 2 === 0) {
      await commentOnTicket(actor, ticket.id, "Checked the restroom and started the follow-up.")
      await transitionTicket(actor, ticket.id, "RESOLVED", "The reported condition was addressed.")
      if (index % 4 === 2) await transitionTicket(actor, ticket.id, "CLOSED", "Supervisor confirmed the resolution.")
    }
  }

  const now = new Date()
  for (const [index, device] of devices.entries()) {
    if (index === 2) {
      await prisma.device.update({
        where: { id: device.id },
        data: { lastSeenAt: new Date(now.getTime() - 5 * 60 * 60 * 1000), status: "OFFLINE", lastSyncError: null, pendingOfflineCount: 0 },
      })
      continue
    }
    if (index === 3) {
      await recordHeartbeat({ deviceCode: device.code, eventAt: now.toISOString(), pendingCount: 2, syncError: "Cellular timeout while uploading one submission." })
      continue
    }
    await recordHeartbeat({ deviceCode: device.code, eventAt: now.toISOString(), pendingCount: index === 4 ? 1 : 0 })
  }

  const present = attendants.filter((id) => id !== staffIds[0])
  for (const [index, staffId] of present.entries()) {
    if (index === 5) continue
    await prisma.staffCheckIn.create({
      data: {
        staffId,
        locationId: locationIds[index % locationIds.length],
        method: "TABLET",
        checkedInAt: zonedTimeToUtc(...parts(today), 6, 10 + index, TIMEZONE),
        matchesAssignment: true,
      },
    })
  }

  console.log("DOMYN development seed completed.")
  console.log("Local accounts use SEED_DEMO_PASSWORD. Default: ChangeMe-Dev-Only!")
  console.log("admin@domyn.local, supervisor@domyn.local, staff@domyn.local, management@domyn.local")
  console.log("Kiosk staff PIN for seeded tablets: 2468")
}

function parts(date: string): [number, number, number] {
  const [year, month, day] = date.split("-").map(Number)
  return [year, month, day]
}

function uniqueReasons(pool: string[], count: number, rand: () => number) {
  const copy = [...pool]
  const chosen: string[] = []
  while (chosen.length < count && copy.length) {
    chosen.push(copy.splice(Math.floor(rand() * copy.length), 1)[0])
  }
  return chosen
}

function mulberry32(seed: number) {
  let value = seed
  return () => {
    value |= 0
    value = (value + 0x6d2b79f5) | 0
    let t = Math.imul(value ^ (value >>> 15), 1 | value)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
