import { z } from "zod"
import { authenticate, endSession, getCurrentUser, setUserPassword, startSession, validatePassword } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { AppError } from "@/lib/errors"
import { assertSameOrigin, handleError, jsonError, jsonOk, readJson } from "@/lib/http"
import { hashPassword } from "@/lib/password"
import { rateLimit } from "@/lib/rate-limit"
import { clientIp } from "@/lib/auth"
import { randomToken, sha256 } from "@/lib/time"

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const url = new URL(request.url)
    const action = url.searchParams.get("action") || "login"
    if (action === "logout") {
      await endSession()
      return jsonOk({ signedOut: true })
    }
    if (action === "password") {
      const user = await getCurrentUser()
      if (!user) return jsonError(401, "UNAUTHENTICATED", "Sign in required.")
      const body = z.object({ currentPassword: z.string(), nextPassword: z.string() }).parse(await readJson(request))
      const account = await prisma.user.findUnique({ where: { id: user.id } })
      if (!account) return jsonError(401, "UNAUTHENTICATED", "Sign in required.")
      const { verifyPassword } = await import("@/lib/password")
      if (!(await verifyPassword(body.currentPassword, account.passwordHash))) {
        return jsonError(400, "VALIDATION", "Current password is incorrect.")
      }
      await setUserPassword(user.id, body.nextPassword)
      await startSession(user.id, request)
      return jsonOk({ updated: true })
    }
    if (action === "forgot") {
      const limit = rateLimit(`forgot:${clientIp(request) ?? "unknown"}`, 5, 15 * 60 * 1000)
      if (!limit.ok) return jsonError(429, "RATE_LIMIT", "Too many reset attempts. Try again later.")
      const body = z.object({ email: z.string().email() }).parse(await readJson(request))
      const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } })
      if (!user || process.env.NODE_ENV === "production") {
        return jsonOk({
          message: "Email delivery is not configured. In production, an administrator must set a new password.",
        })
      }
      const token = randomToken()
      await prisma.passwordReset.create({
        data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      })
      return jsonOk({
        message: "Email delivery is not configured. This local development reset link is shown only outside production.",
        resetPath: `/reset/${token}`,
      })
    }
    if (action === "reset") {
      const body = z.object({ token: z.string(), password: z.string() }).parse(await readJson(request))
      validatePassword(body.password)
      const reset = await prisma.passwordReset.findUnique({ where: { tokenHash: sha256(body.token) } })
      if (!reset || reset.usedAt || reset.expiresAt.getTime() < Date.now()) {
        return jsonError(400, "VALIDATION", "This reset link is invalid or expired.")
      }
      await prisma.user.update({ where: { id: reset.userId }, data: { passwordHash: await hashPassword(body.password) } })
      await prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } })
      await prisma.session.updateMany({ where: { userId: reset.userId, revokedAt: null }, data: { revokedAt: new Date() } })
      return jsonOk({ updated: true })
    }
    const limit = rateLimit(`login:${clientIp(request) ?? "unknown"}`, 10, 15 * 60 * 1000)
    if (!limit.ok) return jsonError(429, "RATE_LIMIT", "Too many sign-in attempts. Try again later.")
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(await readJson(request))
    const user = await authenticate(body.email, body.password)
    await startSession(user.id, request)
    return jsonOk({ id: user.id, name: user.name })
  } catch (error) {
    return handleError(error)
  }
}

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) return jsonError(401, "UNAUTHENTICATED", "Sign in required.")
    return jsonOk(user)
  } catch (error) {
    return handleError(error)
  }
}

void AppError
