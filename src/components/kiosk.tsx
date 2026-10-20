"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { openDB, type DBSchema } from "idb"

type Reason = { code: string; label: string; allowFreeText: boolean; freeTextRequired: boolean }
type Config = {
  deviceCode: string
  locationName: string
  buildingName: string
  floorName: string
  question: string
  thankYou: string
  inactivitySeconds: number
  negativeMaxRating: number
  heartbeatIntervalSec: number
  reasons: Reason[]
}
type QueueItem = {
  clientSubmissionId: string
  restroomCategory: "MALE" | "FEMALE"
  rating: number
  reasonCodes: string[]
  otherText?: string
  eventAt: string
  attempts: number
  nextAttemptAt: number
  lastError?: string
}
interface KioskDb extends DBSchema {
  queue: { key: string; value: QueueItem }
}

const RATINGS = [
  ["1", "Very dissatisfied"],
  ["2", "Dissatisfied"],
  ["3", "Neutral"],
  ["4", "Satisfied"],
  ["5", "Very satisfied"],
] as const

export function Kiosk({ code }: { code: string }) {
  const router = useRouter()
  const [config, setConfig] = useState<Config | null>(null)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [category, setCategory] = useState<"MALE" | "FEMALE" | null>(null)
  const [rating, setRating] = useState<number | null>(null)
  const [reasons, setReasons] = useState<string[]>([])
  const [other, setOther] = useState("")
  const [phase, setPhase] = useState<"form" | "reasons" | "thanks">("form")
  const [pending, setPending] = useState(0)
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine))
  const [syncNote, setSyncNote] = useState("Ready")
  const [pinOpen, setPinOpen] = useState(false)
  const [pin, setPin] = useState("")
  const [pinError, setPinError] = useState<string | null>(null)
  const lock = useRef(false)

  const refreshCount = useCallback(async () => {
    const db = await dbOpen()
    setPending(await db.count("queue"))
  }, [])

  const sync = useCallback(async () => {
    const db = await dbOpen()
    const items = await db.getAll("queue")
    const due = items.filter((item) => item.nextAttemptAt <= Date.now())
    if (!due.length) {
      setSyncNote(items.length ? "Saved on this tablet" : "Synced")
      setPending(items.length)
      return
    }
    setSyncNote("Syncing")
    try {
      const response = await fetch("/api/public?action=sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceCode: code, items: due.map(toPayload) }),
      })
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.error?.message || "Sync failed")
      for (const result of body.data.results as Array<{ clientSubmissionId: string; status: string; error?: string }>) {
        if (result.status === "SYNCED") await db.delete("queue", result.clientSubmissionId)
        else {
          const current = await db.get("queue", result.clientSubmissionId)
          if (!current) continue
          const attempts = current.attempts + 1
          await db.put("queue", { ...current, attempts, lastError: result.error, nextAttemptAt: Date.now() + backoff(attempts) })
        }
      }
      setSyncNote("Synced")
    } catch {
      for (const item of due) {
        const attempts = item.attempts + 1
        await db.put("queue", { ...item, attempts, lastError: "Waiting for a connection", nextAttemptAt: Date.now() + backoff(attempts) })
      }
      setSyncNote("Saved on this tablet")
    }
    setPending(await db.count("queue"))
  }, [code])

  useEffect(() => {
    const cached = localStorage.getItem(`domyn-kiosk-${code}`)
    fetch(`/api/public?code=${encodeURIComponent(code)}`)
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok || !body.ok) throw new Error(body.error?.message || "This tablet is not registered.")
        localStorage.setItem(`domyn-kiosk-${code}`, JSON.stringify(body.data))
        setConfig(body.data)
        setSetupError(null)
      })
      .catch((reason: unknown) => {
        if (cached) {
          setConfig(JSON.parse(cached) as Config)
          return
        }
        setSetupError(reason instanceof Error ? reason.message : "This tablet needs a connection for first-time setup.")
      })
    const onOnline = () => { setOnline(true); void sync() }
    const onOffline = () => setOnline(false)
    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)
    const timer = window.setTimeout(() => { void sync() }, 0)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
    }
  }, [code, sync])

  useEffect(() => {
    if (!config) return
    const beat = () => {
      void fetch("/api/public?action=heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceCode: code, eventAt: new Date().toISOString(), pendingCount: pending, appVersion: "domyn-kiosk" }),
      }).catch(() => undefined)
    }
    beat()
    const timer = window.setInterval(() => {
      void sync()
      beat()
    }, Math.max(30, config.heartbeatIntervalSec) * 1000)
    return () => window.clearInterval(timer)
  }, [config, code, pending, sync])

  function resetForm() {
    setCategory(null)
    setRating(null)
    setReasons([])
    setOther("")
    setPhase("form")
  }

  useEffect(() => {
    if (!config || phase === "thanks") return
    const timer = window.setTimeout(resetForm, config.inactivitySeconds * 1000)
    return () => window.clearTimeout(timer)
  }, [config, phase, category, rating, reasons, other])

  useEffect(() => {
    if (phase !== "thanks") return
    const timer = window.setTimeout(resetForm, 2800)
    return () => window.clearTimeout(timer)
  }, [phase])

  useEffect(() => {
    history.pushState(null, "", location.href)
    const onPop = () => history.pushState(null, "", location.href)
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])

  async function submit(nextRating = rating, nextReasons = reasons) {
    if (!config || !category || !nextRating || lock.current) return
    if (nextRating <= config.negativeMaxRating && nextReasons.length === 0) {
      setPhase("reasons")
      return
    }
    const otherReason = config.reasons.find((reason) => reason.code === "OTHER")
    if (nextReasons.includes("OTHER") && otherReason?.freeTextRequired && !other.trim()) return
    lock.current = true
    const item: QueueItem = {
      clientSubmissionId: crypto.randomUUID(),
      restroomCategory: category,
      rating: nextRating,
      reasonCodes: nextRating <= config.negativeMaxRating ? nextReasons : [],
      otherText: other.trim() || undefined,
      eventAt: new Date().toISOString(),
      attempts: 0,
      nextAttemptAt: Date.now(),
    }
    const db = await dbOpen()
    await db.put("queue", item)
    await refreshCount()
    setPhase("thanks")
    lock.current = false
    void sync()
  }

  if (setupError && !config) {
    return <main className="grid min-h-screen place-items-center bg-white p-8 text-center"><div><p className="text-xs tracking-[0.16em] text-accent">DOMYN</p><h1 className="mt-3 text-2xl font-semibold">This tablet is not ready</h1><p className="mt-2 text-muted">{setupError}</p></div></main>
  }
  if (!config) return <main className="grid min-h-screen place-items-center text-muted">Loading survey…</main>

  return (
    <main className="flex min-h-screen flex-col bg-[#f6f5f1] text-[#17241c]">
      <header className="border-b border-[#d9d6cc] px-8 py-6">
        <p className="text-xs font-semibold tracking-[0.22em] text-[#1c6b43]">DOMYN</p>
        <h1 className="mt-2 text-2xl font-semibold">{config.buildingName}</h1>
        <p className="text-lg">{config.locationName}</p>
        <p className="text-sm text-muted">{config.floorName}</p>
      </header>
      <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-8">
        {phase === "thanks" ? (
          <div className="grid flex-1 place-items-center text-center">
            <div>
              <h2 className="text-4xl font-semibold tracking-tight">{config.thankYou}</h2>
            </div>
          </div>
        ) : phase === "reasons" ? (
          <div>
            <h2 className="text-3xl font-semibold">What should we improve?</h2>
            <p className="mt-1 text-muted">Select every reason that applies.</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {config.reasons.map((reason) => {
                const selected = reasons.includes(reason.code)
                return (
                  <button key={reason.code} type="button" aria-pressed={selected} className={`min-h-20 border px-4 text-left text-lg ${selected ? "border-[#1c6b43] bg-[#e7f3ec]" : "border-[#d9d6cc] bg-white"}`} onClick={() => setReasons((current) => selected ? current.filter((code) => code !== reason.code) : [...current, reason.code])}>
                    {reason.label}
                  </button>
                )
              })}
            </div>
            {reasons.includes("OTHER") ? <label className="field mt-4"><span>Other details {config.reasons.find((reason) => reason.code === "OTHER")?.freeTextRequired ? "" : "(optional)"}</span><textarea className="control" value={other} onChange={(event) => setOther(event.target.value)} maxLength={500} /></label> : null}
            <div className="mt-5 flex gap-2">
              <button type="button" className="h-14 border border-[#d9d6cc] bg-white px-5 text-lg" onClick={() => setPhase("form")}>Back</button>
              <button type="button" className="h-14 flex-1 bg-[#1c6b43] text-lg text-white disabled:opacity-50" disabled={!reasons.length} onClick={() => void submit()}>Submit feedback</button>
            </div>
          </div>
        ) : (
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">{config.question}</h2>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {(["MALE", "FEMALE"] as const).map((value) => (
                <button key={value} type="button" className={`min-h-24 border text-2xl font-medium ${category === value ? "border-[#1c6b43] bg-[#e7f3ec]" : "border-[#d9d6cc] bg-white"}`} onClick={() => setCategory(value)}>
                  {value === "MALE" ? "Male restroom" : "Female restroom"}
                </button>
              ))}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {RATINGS.map(([value, label]) => (
                <button key={value} type="button" disabled={!category} aria-label={`${label}, ${value} of 5`} className={`flex min-h-44 flex-col items-center justify-center border px-2 text-center disabled:opacity-40 ${rating === Number(value) ? "border-[#1c6b43] bg-[#e7f3ec]" : "border-[#d9d6cc] bg-white"}`} onClick={() => { const next = Number(value); setRating(next); if (next > config.negativeMaxRating) void submit(next, []) ; else setPhase("reasons") }}>
                  <span className="text-5xl font-semibold tabular-nums">{value}</span>
                  <span className="mt-2 text-sm leading-tight text-muted">{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
      <footer className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-muted">
        <span>{online ? syncNote : "Offline — feedback is saved on this tablet"}{pending ? ` · ${pending} waiting` : ""}</span>
        <button type="button" className="text-muted" onClick={() => { setPinOpen(true); setPinError(null) }}>Staff access</button>
      </footer>
      {pinOpen ? (
        <div className="fixed inset-0 grid place-items-center bg-[#143026]/70 p-4">
          <form className="w-full max-w-sm border border-[#d9d6cc] bg-white p-5" onSubmit={async (event) => {
            event.preventDefault()
            const response = await fetch("/api/public?action=unlock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceCode: code, pin }) })
            const body = await response.json()
            if (!response.ok || !body.ok) { setPinError(body.error?.message || "Incorrect PIN."); return }
            router.push("/login")
          }}>
            <h2 className="font-semibold">Staff access</h2>
            <p className="mt-1 text-sm text-muted">Enter the tablet PIN to leave the survey.</p>
            <input className="control mt-3 w-full" inputMode="numeric" type="password" value={pin} onChange={(event) => setPin(event.target.value)} aria-label="Tablet PIN" />
            {pinError ? <p className="mt-2 text-sm text-danger">{pinError}</p> : null}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="h-9 px-3" onClick={() => setPinOpen(false)}>Cancel</button>
              <button className="h-9 rounded-md bg-accent px-3 text-white" type="submit">Continue</button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  )
}

function toPayload(item: QueueItem) {
  return { clientSubmissionId: item.clientSubmissionId, restroomCategory: item.restroomCategory, rating: item.rating, reasonCodes: item.reasonCodes, otherText: item.otherText ?? null, eventAt: item.eventAt }
}

function backoff(attempt: number) {
  return Math.min(60000, 2000 * 2 ** Math.min(attempt, 5))
}

function dbOpen() {
  return openDB<KioskDb>("domyn-kiosk", 1, { upgrade(db) { db.createObjectStore("queue", { keyPath: "clientSubmissionId" }) } })
}
