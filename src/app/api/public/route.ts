import { z } from "zod"
import { kioskConfig, recordHeartbeat, unlockKiosk } from "@/server/assets"
import { syncBatch } from "@/server/feedback"
import { AppError } from "@/lib/errors"
import { handleError, jsonOk, readJson } from "@/lib/http"
import { rateLimit } from "@/lib/rate-limit"
import { clientIp } from "@/lib/auth"

const submission = z.object({
  clientSubmissionId: z.string(),
  restroomCategory: z.enum(["MALE", "FEMALE"]),
  rating: z.number().int(),
  reasonCodes: z.array(z.string()).max(12),
  otherText: z.string().max(500).nullable().optional(),
  eventAt: z.string(),
})

export async function POST(request: Request) {
  try {
    const url = new URL(request.url)
    const body = await readJson(request)
    const deviceCode = String((body as { deviceCode?: string }).deviceCode ?? "")
    const limit = rateLimit(`public:${deviceCode}:${clientIp(request) ?? "unknown"}`, 60, 60 * 1000)
    if (!limit.ok) throw new AppError(429, "RATE_LIMIT", "Too many requests from this tablet. Wait a moment and retry.")
    const action = url.searchParams.get("action") || "sync"
    if (action === "heartbeat") {
      const parsed = z.object({
        deviceCode: z.string(),
        eventAt: z.string(),
        pendingCount: z.number().int().min(0),
        syncError: z.string().nullable().optional(),
        appVersion: z.string().nullable().optional(),
      }).parse(body)
      return jsonOk(await recordHeartbeat(parsed))
    }
    if (action === "unlock") {
      const parsed = z.object({ deviceCode: z.string(), pin: z.string() }).parse(body)
      return jsonOk(await unlockKiosk(parsed.deviceCode, parsed.pin))
    }
    const parsed = z.object({ deviceCode: z.string(), items: z.array(submission).min(1).max(50) }).parse(body)
    return jsonOk({
      results: await syncBatch(
        parsed.deviceCode,
        parsed.items.map((item) => ({ ...item, deviceCode: parsed.deviceCode })),
        request.headers.get("user-agent"),
      ),
    })
  } catch (error) {
    return handleError(error)
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const code = url.searchParams.get("code")
    if (!code) throw new AppError(400, "VALIDATION", "Device code is required.")
    return jsonOk(await kioskConfig(code))
  } catch (error) {
    return handleError(error)
  }
}
