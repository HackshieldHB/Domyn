type Bucket = { count: number; reset: number }

const buckets = new Map<string, Bucket>()

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || bucket.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs })
    return { ok: true as const, retryAfterMs: 0 }
  }
  if (bucket.count >= limit) {
    return { ok: false as const, retryAfterMs: bucket.reset - now }
  }
  bucket.count += 1
  return { ok: true as const, retryAfterMs: 0 }
}
