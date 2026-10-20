export type AreaAccess = { buildingId: string | null; locationId: string | null }

export type Actor = {
  id: string
  roleKey: string
  permissions: string[]
  staffId: string | null
  areaAccess: AreaAccess[]
}

export type SessionUser = Actor & {
  name: string
  email: string
  roleName: string
}

export const PERMISSIONS: Array<[string, string]> = [
  ["dashboard.view", "View the operational dashboard"],
  ["feedback.view", "View satisfaction feedback"],
  ["tickets.view", "View complaint tickets"],
  ["tickets.assign", "Assign and reassign tickets"],
  ["tickets.update", "Acknowledge, update, and resolve tickets"],
  ["tickets.close", "Close or reopen tickets"],
  ["tickets.comment", "Add ticket comments"],
  ["staff.view", "View the staff directory"],
  ["staff.manage", "Manage staff records and view contact details"],
  ["shifts.view", "View schedules"],
  ["shifts.manage", "Manage shifts, absences, and replacements"],
  ["checkin.view", "View staff check-ins"],
  ["checkin.create", "Record a staff check-in"],
  ["checkin.correct", "Correct a check-in record"],
  ["locations.view", "View locations"],
  ["locations.manage", "Manage locations"],
  ["devices.view", "View devices"],
  ["devices.manage", "Manage devices and kiosk configuration"],
  ["sla.view", "View SLA monitoring"],
  ["sla.manage", "Manage provisional SLA configuration"],
  ["notifications.view", "View notification logs"],
  ["notifications.retry", "Retry a notification delivery"],
  ["reports.view", "View report descriptions"],
  ["reports.export", "Export authorized reports"],
  ["users.manage", "Manage users, roles, and access"],
  ["audit.view", "View audit logs"],
  ["settings.manage", "Manage system settings"],
  ["decisions.view", "View the pending-decision register"],
  ["decisions.manage", "Annotate the pending-decision register"],
]

export const ROLE_KEYS = ["ADMIN", "SUPERVISOR", "STAFF", "MANAGEMENT"] as const

export function permissionsForRole(roleKey: string) {
  const all = PERMISSIONS.map(([key]) => key)
  if (roleKey === "ADMIN") return all
  if (roleKey === "SUPERVISOR") {
    return all.filter((key) => key !== "users.manage" && key !== "settings.manage")
  }
  if (roleKey === "STAFF") {
    return ["tickets.view", "tickets.update", "tickets.comment", "checkin.view", "checkin.create", "decisions.view"]
  }
  return [
    "dashboard.view",
    "feedback.view",
    "tickets.view",
    "staff.view",
    "shifts.view",
    "checkin.view",
    "locations.view",
    "devices.view",
    "sla.view",
    "notifications.view",
    "reports.view",
    "reports.export",
    "audit.view",
    "decisions.view",
  ]
}

export function hasPermission(actor: { permissions: string[] }, permission: string) {
  return actor.permissions.includes(permission)
}
