import { prisma } from "@/lib/db"
import { jsonError, jsonOk } from "@/lib/http"

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return jsonOk({ status: "ok", database: "connected" })
  } catch {
    return jsonError(503, "UNAVAILABLE", "Database is not reachable.")
  }
}
