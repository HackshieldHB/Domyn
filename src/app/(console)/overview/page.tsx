"use client"

import Link from "next/link"
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { useState } from "react"
import { useResource } from "@/lib/client"
import { Badge, Empty, ErrorNote, Loading, statusTone } from "@/components/ui"

type Dashboard = {
  from: string
  to: string
  timeZone: string
  definitions: Record<string, string>
  kpis: {
    feedback: number
    averageRating: number | null
    positive: number
    negative: number
    openComplaints: number
    newTickets: number
    inProgress: number
    overdue: number
    overdueIsLiveThreshold: boolean
    averageResponseMinutes: number | null
    averageResolutionMinutes: number | null
    coverageLocations: number
    coveredLocations: number
    devicesOnline: number
    devicesOffline: number
  }
  ratings: Array<{ rating: string; count: number }>
  trend: Array<{ day: string; count: number; average: number }>
  reasons: Array<{ label: string; count: number }>
  byStatus: Array<{ status: string; count: number }>
  byLocation: Array<{ label: string; count: number }>
  rangeNote: string
  todayCoverageNote: string
}

type Attention = {
  items: Array<{ id: string; reference: string; status: string; priority: string; locationName: string; assignedStaffName: string | null; fallbackUserName: string | null; sla: { primary: string; ageMinutes: number } }>
}

const CHART = "#1c6b43"
const GRID = "#e2e0d8"

export default function OverviewPage() {
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const query = new URLSearchParams()
  if (from) query.set("from", from)
  if (to) query.set("to", to)
  const { data, error, loading } = useResource<Dashboard>(`/api/v1/dashboard?${query.toString()}`)
  const attention = useResource<Attention>("/api/v1/tickets?pageSize=8")
  const ranked = [...(attention.data?.items ?? [])].sort((a, b) => rank(a.status) - rank(b.status) || b.sla.ageMinutes - a.sla.ageMinutes)
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker">Command</p>
          <h1 className="text-lg font-semibold">What needs a person right now</h1>
        </div>
        <div className="flex gap-2">
          <input className="control" type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From" />
          <input className="control" type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To" />
        </div>
      </div>
      {loading ? <Loading /> : null}
      {error ? <ErrorNote message={error} /> : null}
      {data ? (
        <>
          <p className="mb-2 text-xs text-muted">{data.rangeNote} Feedback is not a visitor count.</p>
          {data.kpis.overdueIsLiveThreshold ? null : <p className="mb-3 border-l-2 border-warning bg-warning-soft px-3 py-2 text-[13px] text-warning">SLA monitoring is inactive. Overdue stays at zero until a threshold is enabled. That is not proof every ticket is on time.</p>}
          <div className="grid grid-cols-2 border border-line bg-surface md:grid-cols-4 xl:grid-cols-8">
            <Cell href="/feedback" label="Feedback" value={String(data.kpis.feedback)} />
            <Cell href="/feedback" label="Rating" value={data.kpis.averageRating == null ? "—" : data.kpis.averageRating.toFixed(2)} />
            <Cell href="/feedback" label="Negative" value={String(data.kpis.negative)} />
            <Cell href="/tickets" label="Open" value={String(data.kpis.openComplaints)} />
            <Cell href="/sla" label="Overdue" value={String(data.kpis.overdue)} />
            <Cell href="/tickets" label="Response" value={minutes(data.kpis.averageResponseMinutes)} />
            <Cell href="/shifts" label="Coverage" value={`${data.kpis.coveredLocations}/${data.kpis.coverageLocations}`} />
            <Cell href="/devices" label="Reachable" value={String(data.kpis.devicesOnline)} />
          </div>
          <p className="mt-2 text-xs text-muted">{data.kpis.newTickets} new · {data.kpis.inProgress} in progress · {data.kpis.positive} positive · {data.kpis.devicesOffline} devices not reachable. {data.todayCoverageNote} {data.definitions.response}</p>
          <div className="mt-5 grid gap-6 xl:grid-cols-[1.5fr_0.8fr]">
            <section>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">Latest complaints, ordered by status</h2>
                <Link className="text-[13px] text-accent" href="/tickets">Worklist</Link>
              </div>
              {attention.loading ? <p className="text-sm text-muted">Loading tickets…</p> : null}
              {attention.error ? <p className="text-sm text-muted">This account cannot load the ticket list.</p> : null}
              {ranked.length ? (
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>Ticket</th><th>Location</th><th>Assignee</th><th>Age</th><th>Status</th></tr></thead>
                    <tbody>
                      {ranked.map((ticket) => (
                        <tr key={ticket.id}>
                          <td><Link className="font-medium text-accent" href={`/tickets/${ticket.id}`}>{ticket.reference}</Link><div className="text-[11px] text-muted">{ticket.priority}</div></td>
                          <td>{ticket.locationName}</td>
                          <td>{ticket.assignedStaffName || ticket.fallbackUserName || "Unassigned"}</td>
                          <td className="tabular-nums">{Math.round(ticket.sla.ageMinutes)} min</td>
                          <td><Badge tone={statusTone(ticket.status)}>{ticket.status.replaceAll("_", " ")}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
            <section>
              <h2 className="mb-2 text-sm font-semibold">By status</h2>
              <ul className="divide-y divide-line border-y border-line">
                {data.byStatus.length ? data.byStatus.map((item) => <li key={item.status} className="flex items-center justify-between py-1.5 text-[13px]"><span>{item.status.replaceAll("_", " ")}</span><span className="tabular-nums">{item.count}</span></li>) : <li className="py-2 text-sm text-muted">No complaints in this range.</li>}
              </ul>
              <h2 className="mb-2 mt-4 text-sm font-semibold">By location</h2>
              <ul className="divide-y divide-line border-y border-line">
                {data.byLocation.slice(0, 6).map((item) => <li key={item.label} className="flex justify-between gap-3 py-1.5 text-[13px]"><span className="truncate">{item.label}</span><span className="tabular-nums">{item.count}</span></li>)}
              </ul>
            </section>
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section>
              <h2 className="mb-2 text-sm font-semibold">Feedback over time</h2>
              {data.trend.length ? <ResponsiveContainer width="100%" height={200}><LineChart data={data.trend}><CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="day" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} /><Tooltip /><Line dataKey="count" name="Submissions" stroke={CHART} strokeWidth={1.5} dot={false} /></LineChart></ResponsiveContainer> : <Empty title="No feedback in this range" body="Submissions appear after tablets sync." />}
            </section>
            <section>
              <h2 className="mb-2 text-sm font-semibold">Rating mix</h2>
              {data.ratings.some((item) => item.count) ? <ResponsiveContainer width="100%" height={200}><BarChart data={data.ratings}><CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="rating" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} /><Tooltip /><Bar dataKey="count" name="Submissions" fill={CHART} /></BarChart></ResponsiveContainer> : <Empty title="No ratings" body="No submissions match the current filters." />}
              {data.reasons.length ? <p className="mt-2 text-xs text-muted">Top reason: {data.reasons[0].label} ({data.reasons[0].count}).</p> : null}
            </section>
          </div>
        </>
      ) : null}
    </div>
  )
}

function Cell({ href, label, value }: { href: string; label: string; value: string }) {
  return (
    <Link href={href} className="border-b border-r border-line px-3 py-2 hover:bg-[#f7faf8]">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums leading-none">{value}</p>
    </Link>
  )
}

function minutes(value: number | null) {
  if (value == null) return "—"
  const rounded = Math.round(value)
  if (rounded >= 1440) return `${Math.round(rounded / 1440)}d`
  if (rounded >= 120) return `${Math.round(rounded / 60)}h`
  return `${rounded}m`
}

function rank(status: string) {
  return ({ NEW: 0, ASSIGNED: 1, IN_PROGRESS: 2, RESOLVED: 3, CLOSED: 4 } as Record<string, number>)[status] ?? 5
}
