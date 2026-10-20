import { getCurrentUser } from "@/lib/auth"
import { jsonError, jsonOk } from "@/lib/http"
import { runSlaSweep } from "@/server/sla"

export async function POST(request: Request) {
  const header = request.headers.get("authorization")
  const secret = process.env.CRON_SECRET
  const user = await getCurrentUser()
  const secretOk = Boolean(secret && header === `Bearer ${secret}`)
  const adminOk = Boolean(user?.permissions.includes("sla.manage"))
  if (!secretOk && !adminOk) return jsonError(401, "UNAUTHENTICATED", "A cron secret or administrator session is required.")
  try {
    return jsonOk(await runSlaSweep(user))
  } catch (error) {
    console.error(error)
    return jsonError(500, "INTERNAL", "SLA sweep failed.")
  }
}
