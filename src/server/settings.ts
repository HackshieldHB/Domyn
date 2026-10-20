import { prisma } from "@/lib/db"

export type SettingKey =
  | "app.timezone"
  | "app.dataLabel"
  | "survey.question"
  | "survey.thankYou"
  | "survey.inactivitySeconds"
  | "survey.negativeMaxRating"
  | "ticket.policy"
  | "ticket.groupingEnabled"
  | "ticket.groupingWindowMinutes"
  | "sla.clock"
  | "sla.delayedSyncMinutes"
  | "sla.escalationEnabled"
  | "device.defaultHeartbeatSec"
  | "device.defaultStaleSec"
  | "security.sessionHours"
  | "checkin.method"

export type SettingValues = {
  "app.timezone": string
  "app.dataLabel": string
  "survey.question": string
  "survey.thankYou": string
  "survey.inactivitySeconds": number
  "survey.negativeMaxRating": number
  "ticket.policy": "PER_SUBMISSION" | "PER_REASON"
  "ticket.groupingEnabled": boolean
  "ticket.groupingWindowMinutes": number
  "sla.clock": "RECEIVED_AT" | "EVENT_AT"
  "sla.delayedSyncMinutes": number
  "sla.escalationEnabled": boolean
  "device.defaultHeartbeatSec": number
  "device.defaultStaleSec": number
  "security.sessionHours": number
  "checkin.method": "TABLET" | "MOBILE"
}

export const SETTING_DEFAULTS: SettingValues = {
  "app.timezone": process.env.APP_TIMEZONE || "Asia/Jakarta",
  "app.dataLabel": "",
  "survey.question": "How satisfied are you with this restroom?",
  "survey.thankYou": "Thank you. Your feedback helps us improve this restroom.",
  "survey.inactivitySeconds": 45,
  "survey.negativeMaxRating": 3,
  "ticket.policy": "PER_SUBMISSION",
  "ticket.groupingEnabled": false,
  "ticket.groupingWindowMinutes": 60,
  "sla.clock": "RECEIVED_AT",
  "sla.delayedSyncMinutes": 10,
  "sla.escalationEnabled": false,
  "device.defaultHeartbeatSec": 60,
  "device.defaultStaleSec": 180,
  "security.sessionHours": 12,
  "checkin.method": "TABLET",
}

export const SETTING_CATALOG: Array<{
  key: SettingKey
  label: string
  description: string
  provisional: boolean
}> = [
  {
    key: "app.timezone",
    label: "Display timezone",
    description: "IANA timezone for operational display. Stored timestamps remain UTC.",
    provisional: true,
  },
  {
    key: "app.dataLabel",
    label: "Data banner",
    description: "Shown in the console when the database contains labeled demonstration data. Clear it for a live site.",
    provisional: false,
  },
  {
    key: "survey.question",
    label: "Survey question",
    description: "Primary question on the public tablet. Wording is pending TLT approval.",
    provisional: true,
  },
  {
    key: "survey.thankYou",
    label: "Thank-you message",
    description: "Shown after a successful submission.",
    provisional: true,
  },
  {
    key: "survey.inactivitySeconds",
    label: "Kiosk inactivity reset",
    description: "Seconds of inactivity before the tablet returns to the first screen.",
    provisional: true,
  },
  {
    key: "survey.negativeMaxRating",
    label: "Negative rating ceiling",
    description: "Ratings at or below this value ask for reasons and can open a complaint.",
    provisional: true,
  },
  {
    key: "ticket.policy",
    label: "Ticket generation policy",
    description: "PER_SUBMISSION or PER_REASON. The development default is one ticket per submission and is not an approved business rule.",
    provisional: true,
  },
  {
    key: "ticket.groupingEnabled",
    label: "Group similar complaints",
    description: "Optional grouping. Original feedback is never deleted or hidden.",
    provisional: true,
  },
  {
    key: "ticket.groupingWindowMinutes",
    label: "Grouping window",
    description: "Minutes used when similar-complaint grouping is enabled.",
    provisional: true,
  },
  {
    key: "sla.clock",
    label: "SLA clock start",
    description: "RECEIVED_AT starts the response clock when the server stores the complaint. EVENT_AT uses the device event time. This is pending TLT validation.",
    provisional: true,
  },
  {
    key: "sla.delayedSyncMinutes",
    label: "Delayed sync threshold",
    description: "Gap between event time and server receipt time that flags delayed synchronization.",
    provisional: true,
  },
  {
    key: "sla.escalationEnabled",
    label: "Escalation job",
    description: "When disabled, overdue notifications are not sent. Enable only after escalation recipients are approved.",
    provisional: true,
  },
  {
    key: "device.defaultHeartbeatSec",
    label: "Default heartbeat",
    description: "Suggested heartbeat interval for new devices, in seconds.",
    provisional: true,
  },
  {
    key: "device.defaultStaleSec",
    label: "Default stale threshold",
    description: "A device is offline when no heartbeat arrives within this many seconds.",
    provisional: true,
  },
  {
    key: "security.sessionHours",
    label: "Session length",
    description: "Internal session lifetime in hours.",
    provisional: false,
  },
  {
    key: "checkin.method",
    label: "Preferred check-in method",
    description: "TABLET or MOBILE. The final capture method is pending validation.",
    provisional: true,
  },
]

export async function getSettings(): Promise<SettingValues> {
  const rows = await prisma.systemSetting.findMany()
  const values = { ...SETTING_DEFAULTS }
  for (const row of rows) {
    if (row.key in values) {
      ;(values as Record<string, unknown>)[row.key] = row.value
    }
  }
  return values
}

export function appBaseUrl() {
  return process.env.APP_BASE_URL || "http://localhost:3000"
}
