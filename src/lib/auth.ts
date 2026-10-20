import { cache } from "react"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/db"
import { sha256, randomToken } from "@/lib/time"
import { verifyPassword, hashPassword } from "@/lib/password"
import { getSettings } from "@/server/settings"
import { AppError } from "@/lib/errors"
import type { SessionUser } from "@/lib/permissions"

export const SESSION_COOKIE = "domyn_session"

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token) return null
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: {
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
          areaAccess: true,
          staffProfile: { select: { id: true } },
        },
      },
    },
  })
  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now() || !session.user.active) return null
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    roleKey: session.user.role.key,
    roleName: session.user.role.name,
    permissions: session.user.role.permissions.map((item) => item.permission.key),
    staffId: session.user.staffProfile?.id ?? null,
    areaAccess: session.user.areaAccess.map((access) => ({
      buildingId: access.buildingId,
      locationId: access.locationId,
    })),
  }
})

export async function requireUser() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  return user
}

export async function startSession(userId: string, request: Request) {
  const settings = await getSettings()
  const hours = Number(settings["security.sessionHours"]) || 12
  const token = randomToken()
  await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + hours * 3600 * 1000),
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
    },
  })
  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: hours * 3600,
  })
}

export async function endSession() {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token) {
    await prisma.session.updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }
  jar.delete(SESSION_COOKIE)
}

export async function authenticate(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
  if (!user || !user.active) throw new AppError(401, "INVALID_LOGIN", "Email or password is incorrect.")
  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) throw new AppError(401, "INVALID_LOGIN", "Email or password is incorrect.")
  return user
}

export async function revokeUserSessions(userId: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export async function setUserPassword(userId: string, password: string) {
  validatePassword(password)
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password) } })
  await revokeUserSessions(userId)
}

export function validatePassword(password: string) {
  if (password.length < 12) throw new AppError(400, "VALIDATION", "Use a password of at least 12 characters.")
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new AppError(400, "VALIDATION", "Use a password that contains letters and numbers.")
  }
}

export function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")
  if (!forwarded) return null
  return forwarded.split(",")[0]?.trim() || null
}
