import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { maskPhone, notificationDedupeKey } from "@/server/domain"
import { appBaseUrl } from "@/server/settings"

export type NoticePayload = {
  reference: string
  location: string
  category: string
  rating: number
  reasons: string[]
  eventAt: string
  status: string
  link: string
  eventType: string
}

type RecipientInput = {
  role: "PRIMARY" | "FALLBACK" | "SUPERVISOR" | "WATCHER"
  userId?: string | null
  staffId?: string | null
  phone?: string | null
}

export function renderNotice(payload: NoticePayload) {
  return [
    `DOMYN ${payload.reference}`,
    `${payload.location} · ${payload.category === "MALE" ? "Male" : "Female"} restroom`,
    `Rating ${payload.rating}/5`,
    payload.reasons.length ? payload.reasons.join("; ") : "No dissatisfaction reason recorded",
    `Event time ${payload.eventAt}`,
    `Status ${payload.status}`,
    payload.link,
  ].join("\n")
}

export async function queueNotification(
  tx: Prisma.TransactionClient,
  input: {
    ticketId: string
    eventType: string
    qualifier?: string
    payload: NoticePayload
    recipients: RecipientInput[]
  },
) {
  const dedupeKey = notificationDedupeKey(input.eventType, input.ticketId, input.qualifier)
  const existing = await tx.notification.findUnique({ where: { dedupeKey } })
  if (existing) return null
  const mode = process.env.WHATSAPP_PROVIDER === "whatsapp" ? "WHATSAPP" : "SANDBOX"
  const seen = new Set<string>()
  const recipients = input.recipients.filter((recipient) => {
    const key = recipient.staffId ? `s:${recipient.staffId}` : recipient.userId ? `u:${recipient.userId}` : ""
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
  const created = await tx.notification.create({
    data: {
      ticketId: input.ticketId,
      eventType: input.eventType,
      dedupeKey,
      status: recipients.length ? "PENDING" : "SKIPPED",
      mode,
      payload: input.payload,
      recipients: {
        create: recipients.map((recipient) => ({
          role: recipient.role,
          userId: recipient.userId ?? null,
          staffId: recipient.staffId ?? null,
          phoneMasked: maskPhone(recipient.phone, false),
        })),
      },
    },
  })
  return created.id
}

export function ticketLink(ticketId: string) {
  return `${appBaseUrl()}/tickets/${ticketId}`
}

export async function dispatchNotification(id: string) {
  const notification = await prisma.notification.findUnique({
    where: { id },
    include: { recipients: true },
  })
  if (!notification || notification.status === "SENT" || notification.status === "SKIPPED") return notification
  const provider = createProvider()
  let successes = 0
  let failures = 0
  for (const recipient of notification.recipients) {
    const phone = await destinationPhone(recipient.staffId, recipient.userId)
    if (!phone) {
      failures += 1
      await prisma.notificationAttempt.create({
        data: {
          notificationId: notification.id,
          recipientId: recipient.id,
          provider: provider.name,
          success: false,
          simulated: provider.simulated,
          error: "No destination phone number is configured for this recipient.",
        },
      })
      continue
    }
    try {
      const result = await provider.send({ to: phone, body: renderNotice(notification.payload as NoticePayload) })
      if (result.ok) successes += 1
      else failures += 1
      await prisma.notificationAttempt.create({
        data: {
          notificationId: notification.id,
          recipientId: recipient.id,
          provider: provider.name,
          success: result.ok,
          simulated: result.simulated,
          response: result.response as Prisma.InputJsonValue,
          error: result.error ?? null,
        },
      })
    } catch (error) {
      failures += 1
      await prisma.notificationAttempt.create({
        data: {
          notificationId: notification.id,
          recipientId: recipient.id,
          provider: provider.name,
          success: false,
          simulated: provider.simulated,
          error: error instanceof Error ? error.message : "Delivery failed.",
        },
      })
    }
  }
  const status = failures === 0 && successes > 0 ? "SENT" : successes === 0 && failures === 0 ? "SKIPPED" : "FAILED"
  return prisma.notification.update({ where: { id }, data: { status } })
}

async function destinationPhone(staffId: string | null, userId: string | null) {
  if (staffId) {
    const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { phone: true } })
    if (staff?.phone) return staff.phone
  }
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } })
    return user?.phone ?? null
  }
  return null
}

type Provider = {
  name: string
  simulated: boolean
  send: (input: { to: string; body: string }) => Promise<{ ok: boolean; simulated: boolean; response: unknown; error?: string }>
}

function createProvider(): Provider {
  if (process.env.WHATSAPP_PROVIDER === "whatsapp") return whatsappProvider()
  return {
    name: "sandbox",
    simulated: true,
    async send() {
      return {
        ok: true,
        simulated: true,
        response: { provider: "sandbox", deliveredToWhatsApp: false, note: "Simulated delivery. No WhatsApp message was sent." },
      }
    },
  }
}

function whatsappProvider(): Provider {
  const url = process.env.WHATSAPP_API_URL
  const token = process.env.WHATSAPP_TOKEN
  const sender = process.env.WHATSAPP_SENDER
  const template = process.env.WHATSAPP_TEMPLATE_NAME
  return {
    name: "whatsapp",
    simulated: false,
    async send({ to, body }) {
      if (!url || !token || !sender || !template) {
        return {
          ok: false,
          simulated: false,
          response: null,
          error: "WhatsApp credentials or an approved template are not configured.",
        }
      }
      const response = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: sender,
          to,
          template,
          body,
        }),
        signal: AbortSignal.timeout(10000),
      })
      const text = (await response.text()).slice(0, 500).replaceAll(token, "[redacted]")
      if (!response.ok) {
        return { ok: false, simulated: false, response: { status: response.status, body: text }, error: `WhatsApp provider responded ${response.status}.` }
      }
      return { ok: true, simulated: false, response: { status: response.status, body: text } }
    },
  }
}

export async function dispatchMany(ids: string[]) {
  for (const id of ids) {
    try {
      await dispatchNotification(id)
    } catch (error) {
      console.error("Notification dispatch failed", error instanceof Error ? error.message : error)
    }
  }
}
