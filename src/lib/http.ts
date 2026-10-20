import { ZodError } from "zod"
import { getCurrentUser } from "@/lib/auth"
import { AppError } from "@/lib/errors"
import type { SessionUser } from "@/lib/permissions"

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin")
  if (!origin) return
  const host = request.headers.get("host")
  let originHost = ""
  try {
    originHost = new URL(origin).host
  } catch {
    throw new AppError(403, "ORIGIN", "Cross-origin request rejected.")
  }
  if (!host || originHost !== host) throw new AppError(403, "ORIGIN", "Cross-origin request rejected.")
}

export async function readJson(request: Request) {
  try {
    return await request.json()
  } catch {
    throw new AppError(400, "VALIDATION", "Request body must be JSON.")
  }
}

export function jsonOk(data: unknown, status = 200) {
  return Response.json({ ok: true, data }, { status })
}

export function jsonError(status: number, code: string, message: string, details?: unknown) {
  return Response.json({ ok: false, error: { code, message, details: details ?? null } }, { status })
}

export function handleError(error: unknown) {
  if (error instanceof AppError) return jsonError(error.status, error.code, error.message, error.details)
  if (error instanceof ZodError) {
    return jsonError(
      400,
      "VALIDATION",
      "The request is not valid.",
      error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    )
  }
  console.error(error)
  return jsonError(500, "INTERNAL", "The request could not be completed.")
}

export function pageParams(url: URL) {
  const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page")) || 1))
  const pageSize = Math.min(100, Math.max(1, Math.trunc(Number(url.searchParams.get("pageSize")) || 25)))
  return { page, pageSize, skip: (page - 1) * pageSize }
}

type Handler = (context: { request: Request; user: SessionUser; params: Record<string, string> }) => Promise<Response>

export function withAuth(permission: string | null, handler: Handler) {
  return async (request: Request, route?: { params: Promise<Record<string, string>> }) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") assertSameOrigin(request)
      const user = await getCurrentUser()
      if (!user) return jsonError(401, "UNAUTHENTICATED", "Sign in required.")
      if (permission && !user.permissions.includes(permission)) {
        return jsonError(403, "FORBIDDEN", "You do not have access to this action.")
      }
      const params = route?.params ? await route.params : {}
      return await handler({ request, user, params })
    } catch (error) {
      return handleError(error)
    }
  }
}

export function withPublic(handler: (context: { request: Request; params: Record<string, string> }) => Promise<Response>) {
  return async (request: Request, route?: { params: Promise<Record<string, string>> }) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") assertSameOrigin(request)
      const params = route?.params ? await route.params : {}
      return await handler({ request, params })
    } catch (error) {
      return handleError(error)
    }
  }
}
