"use client"

import { useState } from "react"
import { useResource } from "@/lib/client"
import { Empty, ErrorNote, Loading } from "@/components/ui"

type FeedbackPageData = {
  total: number
  timeZone: string
  items: Array<{ id: string; rating: number; category: string; locationName: string; buildingName: string; deviceCode: string; reasons: string[]; eventAt: string; receivedAt: string; clockDriftMs: number | null; tickets: Array<{ id?: string; reference: string }> }>
}

export default function FeedbackPage() {
  const [category, setCategory] = useState("")
  const [maxRating, setMaxRating] = useState("")
  const params = new URLSearchParams()
  if (category) params.set("category", category)
  const { data, error, loading } = useResource<FeedbackPageData>(`/api/v1/feedback?${params.toString()}`)
  const visible = (data?.items ?? []).filter((item) => !maxRating || item.rating <= Number(maxRating))
  const counts = [1, 2, 3, 4, 5].map((rating) => visible.filter((item) => item.rating === rating).length)
  const low = visible.filter((item) => item.rating <= 3).length
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
        <div>
          <p className="kicker">Satisfaction workbench</p>
          <h1 className="text-lg font-semibold">Feedback</h1>
          <p className="text-[13px] text-muted">Event time and server receipt time stay separate. Ratings 4–5 do not open a ticket.</p>
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Restroom category">
          {[["", "All"], ["MALE", "Male"], ["FEMALE", "Female"]].map(([value, label]) => (
            <button key={label} type="button" className={`h-8 border px-2 text-[13px] ${category === value ? "border-accent bg-accent-soft text-accent" : "border-line bg-white"}`} onClick={() => setCategory(value)}>{label}</button>
          ))}
        </div>
      </div>
      {loading ? <Loading /> : null}
      {error ? <ErrorNote message={error} /> : null}
      {data ? (
        <div className="mb-3 flex flex-wrap items-center gap-4 text-[13px]">
          <span className="tabular-nums">{data.total} in the query · {visible.length} shown</span>
          <span>{low} at rating 1–3 on this page</span>
          <span className="flex items-end gap-1" aria-label="Rating counts on this page">
            {counts.map((count, index) => <span key={index} className="flex w-6 flex-col items-center"><span className="w-full bg-accent" style={{ height: `${Math.max(4, count * 4)}px` }} /><span className="text-[10px] text-muted">{index + 1}</span></span>)}
          </span>
          <label className="ml-auto flex items-center gap-2 text-muted">Show up to
            <select className="control" value={maxRating} onChange={(event) => setMaxRating(event.target.value)} aria-label="Maximum rating on this page">
              <option value="">Any rating</option>
              <option value="3">1–3 only</option>
              <option value="2">1–2 only</option>
            </select>
          </label>
        </div>
      ) : null}
      {data && !visible.length ? <Empty title="No feedback" body="Nothing matches this restroom and rating filter." /> : null}
      {visible.length ? (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Score</th><th>Place</th><th>Reasons</th><th>Device</th><th>Event</th><th>Received</th><th>Ticket</th></tr></thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id} className={item.rating <= 3 ? "bg-[#fbf6f2]" : undefined}>
                  <td><Score value={item.rating} /></td>
                  <td>{item.locationName}<div className="text-[11px] text-muted">{item.buildingName} · {item.category}</div></td>
                  <td className="max-w-xs">{item.reasons.join(", ") || "—"}</td>
                  <td className="font-mono text-[12px]">{item.deviceCode}</td>
                  <td>{stamp(item.eventAt)}</td>
                  <td>{stamp(item.receivedAt)}{item.clockDriftMs && Math.abs(item.clockDriftMs) > 10 * 60000 ? <div className="text-[11px] text-warning">Delayed sync</div> : null}</td>
                  <td>{item.tickets.length ? item.tickets.map((ticket) => <span key={ticket.reference} className="mr-2">{ticket.reference}</span>) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

function Score({ value }: { value: number }) {
  return <span className="font-mono text-[13px] tabular-nums" aria-label={`${value} of 5`}>{value}<span className="text-muted">/5</span></span>
}

function stamp(value: string) {
  return new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
}
