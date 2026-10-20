"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import { api, useResource } from "@/lib/client"
import { Badge, Button, ErrorNote, Loading, statusTone, useToast } from "@/components/ui"

type Ticket = {
  id: string
  reference: string
  status: string
  priority: string
  rating: number
  category: string
  locationName: string
  buildingName: string
  floorName: string
  assignedStaffName: string | null
  fallbackReason: string | null
  assignmentSource: string | null
  reasons: Array<{ label: string }>
  eventAt: string
  receivedAt: string
  acknowledgedAt: string | null
  firstProgressAt: string | null
  resolvedAt: string | null
  closedAt: string | null
  sla: { primary: string; responseMinutes: number | null; resolutionMinutes: number | null; ageMinutes: number; states: string[] }
  comments: Array<{ id: string; body: string; author: string; createdAt: string }>
  statusHistory: Array<{ id: string; fromStatus: string | null; toStatus: string; actor: string; note: string | null; createdAt: string }>
  events: Array<{ id: string; type: string; message: string; createdAt: string }>
  submissions: Array<{ id: string; rating: number; category: string; eventAt: string; receivedAt: string; reasons: string[]; otherText: string | null; deviceCode: string }>
  group: { tickets: Array<{ id: string; reference: string; status: string }> } | null
}

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>()
  const toast = useToast()
  const { data, error, loading, reload } = useResource<Ticket>(params.id ? `/api/v1/tickets/${params.id}` : null)
  const [note, setNote] = useState("")
  const [staffId, setStaffId] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)

  async function run(path: string, body: unknown) {
    setBusy(true)
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) })
      setNote("")
      toast("Ticket updated.")
      reload()
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "Update failed.")
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Loading />
  if (error) return <ErrorNote message={error} />
  if (!data) return null
  const steps = ["NEW", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"]
  const timeline = [
    ...data.events.map((event) => ({ id: event.id, at: event.createdAt, title: event.message, meta: event.type })),
    ...data.comments.map((comment) => ({ id: comment.id, at: comment.createdAt, title: comment.body, meta: comment.author })),
  ].sort((a, b) => a.at.localeCompare(b.at))
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div>
        <p className="kicker">{data.buildingName} · {data.floorName}</p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-lg font-semibold">{data.reference}</h1>
          <Badge tone={statusTone(data.status)}>{data.status.replaceAll("_", " ")}</Badge>
          <span className="text-[13px] text-muted">{data.priority}</span>
        </div>
        <p className="mt-1 text-[13px]">{data.locationName} · {data.category === "MALE" ? "Male" : "Female"} · rating {data.rating}/5</p>
        <p className="text-[13px] text-muted">{data.reasons.map((item) => item.label).join(" · ") || "No reason recorded"}</p>
        <ol className="mt-4 flex gap-4 border-y border-line py-2 text-[11px] uppercase tracking-wide">
          {steps.map((step) => <li key={step} className={step === data.status ? "font-semibold text-accent" : "text-muted"}>{step.replaceAll("_", " ")}</li>)}
        </ol>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] md:grid-cols-3">
          <Stamp label="Event" value={data.eventAt} />
          <Stamp label="Received" value={data.receivedAt} />
          <Stamp label="Acknowledged" value={data.acknowledgedAt} />
          <Stamp label="First progress" value={data.firstProgressAt} />
          <Stamp label="Resolved" value={data.resolvedAt} />
          <Stamp label="Closed" value={data.closedAt} />
        </dl>
        <p className="mt-3 text-xs text-muted">Assignee: {data.assignedStaffName || "None"}{data.assignmentSource ? ` · ${data.assignmentSource}` : ""}. Acknowledgement, progress, resolution, and closure stay separate. Check-in is not proof of cleaning.</p>
        {data.fallbackReason ? <p className="mt-1 text-[13px] text-warning">{data.fallbackReason}</p> : null}
        <h2 className="mb-2 mt-6 text-sm font-semibold">Source feedback</h2>
        {data.submissions.map((submission) => (
          <p key={submission.id} className="border-t border-line py-2 text-[13px]">Rating {submission.rating} · {submission.reasons.join(", ") || "No reason"} · {submission.deviceCode}{submission.otherText ? ` · ${submission.otherText}` : ""}</p>
        ))}
        {data.group ? <p className="text-xs text-muted">Grouped with {data.group.tickets.map((ticket) => ticket.reference).join(", ")}. Original submissions remain.</p> : null}
        <h2 className="mb-2 mt-6 text-sm font-semibold">Timeline</h2>
        <ol className="border-l border-line pl-4">
          {timeline.map((item) => (
            <li key={item.id} className="relative mb-3">
              <span className="absolute -left-[19px] top-1 h-1.5 w-1.5 bg-accent" aria-hidden />
              <p className="text-[11px] text-muted">{new Date(item.at).toLocaleString()} · {item.meta}</p>
              <p className="text-[13px]">{item.title}</p>
            </li>
          ))}
        </ol>
      </div>
      <aside className="h-fit border border-line bg-surface p-3 lg:sticky lg:top-4">
        <p className="text-[11px] uppercase tracking-wide text-muted">SLA</p>
        <div className="mt-1"><Badge tone={statusTone(data.sla.primary)}>{data.sla.primary.replaceAll("_", " ")}</Badge></div>
        <p className="mt-2 text-xs text-muted">Age {Math.round(data.sla.ageMinutes)} min. Response {data.sla.responseMinutes == null ? "—" : `${Math.round(data.sla.responseMinutes)} min`}. Resolution {data.sla.resolutionMinutes == null ? "—" : `${Math.round(data.sla.resolutionMinutes)} min`}.</p>
        <label className="field mt-4"><span>Note</span><textarea className="control" value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <div className="mt-3 flex flex-col gap-2">
          {data.status === "ASSIGNED" ? <Button disabled={busy} onClick={() => run(`/api/v1/tickets/${data.id}/transition`, { to: "IN_PROGRESS", note })}>Acknowledge</Button> : null}
          {data.status === "IN_PROGRESS" ? <Button disabled={busy} onClick={() => run(`/api/v1/tickets/${data.id}/comments`, { body: note || "Progress updated." })}>Add progress</Button> : null}
          {data.status === "IN_PROGRESS" ? <Button disabled={busy} onClick={() => run(`/api/v1/tickets/${data.id}/transition`, { to: "RESOLVED", note })}>Resolve</Button> : null}
          {data.status === "RESOLVED" ? <Button disabled={busy} onClick={() => run(`/api/v1/tickets/${data.id}/transition`, { to: "CLOSED", note })}>Close</Button> : null}
        </div>
        <label className="field mt-4"><span>Reassign staff id</span><input className="control" value={staffId} onChange={(event) => setStaffId(event.target.value)} /></label>
        <label className="field mt-2"><span>Reason</span><input className="control" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <div className="mt-2"><Button variant="secondary" disabled={busy || !staffId || !reason} onClick={() => run(`/api/v1/tickets/${data.id}/assign`, { staffId, reason })}>Reassign</Button></div>
      </aside>
    </div>
  )
}

function Stamp({ label, value }: { label: string; value: string | null }) {
  return <div><dt className="text-xs text-muted">{label}</dt><dd>{value ? new Date(value).toLocaleString() : "—"}</dd></div>
}
