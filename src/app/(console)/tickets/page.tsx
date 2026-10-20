"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { DataTable } from "@/components/data-table"
import { useResource } from "@/lib/client"
import { Badge, Empty, ErrorNote, Loading, statusTone } from "@/components/ui"

type TicketList = {
  items: Array<{
    id: string
    reference: string
    status: string
    priority: string
    rating: number
    category: string
    locationName: string
    buildingName: string
    assignedStaffName: string | null
    fallbackUserName: string | null
    reasons: Array<{ label: string }>
    receivedAt: string
    sla: { primary: string; ageMinutes: number }
  }>
  total: number
  page: number
  timeZone: string
}

export default function TicketsPage() {
  const [status, setStatus] = useState("")
  const [q, setQ] = useState("")
  const params = new URLSearchParams()
  if (status) params.set("status", status)
  if (q) params.set("q", q)
  const { data, error, loading } = useResource<TicketList>(`/api/v1/tickets?${params.toString()}`)
  const columns = useMemo<ColumnDef<TicketList["items"][number], unknown>[]>(() => [
    { header: "Reference", cell: ({ row }) => <Link className="font-medium text-accent" href={`/tickets/${row.original.id}`}>{row.original.reference}</Link> },
    { header: "Location", cell: ({ row }) => <span>{row.original.buildingName}<span className="block text-xs text-muted">{row.original.locationName} · {row.original.category}</span></span> },
    { header: "Priority", cell: ({ row }) => <span className={row.original.priority === "HIGH" || row.original.priority === "URGENT" ? "font-semibold text-danger" : "text-muted"}>{row.original.priority}</span> },
    { header: "Rating", cell: ({ row }) => `${row.original.rating}/5` },
    { header: "Reasons", cell: ({ row }) => row.original.reasons.map((reason) => reason.label).join(", ") || "—" },
    { header: "Assignee", cell: ({ row }) => row.original.assignedStaffName || row.original.fallbackUserName || "Unassigned" },
    { header: "Status", cell: ({ row }) => <Badge tone={statusTone(row.original.status)}>{row.original.status.replaceAll("_", " ")}</Badge> },
    { header: "SLA", cell: ({ row }) => <span><Badge tone={statusTone(row.original.sla.primary)}>{row.original.sla.primary.replaceAll("_", " ")}</Badge><span className="block text-xs text-muted">{Math.round(row.original.sla.ageMinutes)} min</span></span> },
    { header: "Received", cell: ({ row }) => new Date(row.original.receivedAt).toLocaleString("en-GB", { timeZone: data?.timeZone, hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }) },
  ], [data?.timeZone])
  const statuses = ["", "NEW", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"]
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker">Complaint worklist</p>
          <h1 className="text-lg font-semibold">Tickets</h1>
        </div>
        <input className="control w-48" placeholder="Reference" value={q} onChange={(event) => setQ(event.target.value)} aria-label="Search reference" />
      </div>
      <div className="mb-3 flex flex-wrap border-b border-line" role="tablist" aria-label="Status">
        {statuses.map((item) => (
          <button key={item || "all"} type="button" className={`-mb-px border-b-2 px-3 py-1.5 text-[13px] ${status === item ? "border-accent font-medium text-accent" : "border-transparent text-muted"}`} onClick={() => setStatus(item)}>{item ? item.replaceAll("_", " ") : "All"}</button>
        ))}
      </div>
      {loading ? <Loading /> : null}
      {error ? <ErrorNote message={error} /> : null}
      {data && !data.items.length ? <Empty title="No tickets" body="Tickets appear when a rating at or below the configured threshold is received." /> : null}
      {data && data.items.length ? <DataTable columns={columns} data={data.items} /> : null}
      {data ? <p className="mt-2 text-xs text-muted">{data.total} tickets. The generation policy is a provisional setting.</p> : null}
    </div>
  )
}
