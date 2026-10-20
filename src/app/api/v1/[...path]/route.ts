import { dispatch } from "@/server/api"
import { withAuth } from "@/lib/http"

async function handle(method: string, request: Request, params: Record<string, string | string[]>) {
  const path = params.path
  const parts = Array.isArray(path) ? path : String(path ?? "").split("/").filter(Boolean)
  return withAuth(null, async ({ request: current, user }) => dispatch(method, parts, current, user))(request)
}

export const GET = (request: Request, context: { params: Promise<Record<string, string | string[]>> }) =>
  context.params.then((params) => handle("GET", request, params))

export const POST = (request: Request, context: { params: Promise<Record<string, string | string[]>> }) =>
  context.params.then((params) => handle("POST", request, params))

export const PUT = (request: Request, context: { params: Promise<Record<string, string | string[]>> }) =>
  context.params.then((params) => handle("PUT", request, params))
