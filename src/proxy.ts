import { NextResponse, type NextRequest } from "next/server"

const PUBLIC_PREFIXES = ["/login", "/forgot", "/reset", "/kiosk", "/api/public", "/api/auth", "/api/health", "/api/jobs"]

export function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-request-id", crypto.randomUUID())
  const { pathname } = request.nextUrl
  const session = request.cookies.get("domyn_session")?.value
  const isPublic = PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  const isAsset = pathname.startsWith("/_next") || pathname === "/favicon.ico"
  if (!isAsset && !isPublic && !pathname.startsWith("/api") && !session) {
    const login = new URL("/login", request.url)
    login.searchParams.set("next", pathname)
    return NextResponse.redirect(login)
  }
  if (pathname === "/login" && session) {
    return NextResponse.redirect(new URL("/overview", request.url))
  }
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set("x-request-id", requestHeaders.get("x-request-id") ?? "")
  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
}
