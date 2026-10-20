"use client"

import { useState } from "react"
import { api, useResource } from "@/lib/client"
import { Badge, Button, ErrorNote, Loading, statusTone, useToast } from "@/components/ui"

type Sla = { notice: string; settings: { clock: string; delayedSyncMinutes: number; escalationEnabled: boolean }; configs: Array<{ id: string; name: string; responseMinutes: number | null; active: boolean; provisional: boolean; notes: string | null }>; events: Array<{ id: string; type: string; message: string; reference: string; createdAt: string }> }

export default function SlaPage() {
  const { data, error, loading, reload } = useResource<Sla>("/api/v1/sla")
  const toast = useToast()
  const [name, setName] = useState("Provisional response threshold")
  const [minutes, setMinutes] = useState(20)
  return (
    <div>
      <p className="kicker">Service targets</p>
      <h1 className="text-lg font-semibold">SLA</h1>
      <p className="mb-3 text-[13px] text-muted">Nothing here is an approved promise until it is marked active. The 20-minute example stays provisional.</p>
      {loading ? <Loading /> : null}
      {error ? <ErrorNote message={error} /> : null}
      {data ? (
        <div className="space-y-4">
          <p className="border-l-2 border-warning bg-warning-soft px-3 py-2 text-[13px] text-warning">{data.configs.some((config) => config.active) ? "A threshold is active." : "Monitoring inactive."} {data.notice}</p>
          <p className="text-[13px] text-muted">Clock: {data.settings.clock}. Delayed sync flag: {data.settings.delayedSyncMinutes} minutes. Escalation {data.settings.escalationEnabled ? "enabled" : "disabled"}.</p>
          <form className="flex flex-wrap items-end gap-2 border-y border-line bg-surface px-2 py-2" onSubmit={async (event) => {
            event.preventDefault()
            try {
              await api("/api/v1/sla", { method: "POST", body: JSON.stringify({ name, responseMinutes: minutes, graceMinutes: 0, active: false, notes: "Created from the console. Remains provisional and inactive until explicitly enabled." }) })
              toast("Provisional SLA saved as inactive.")
              reload()
            } catch (reason) { toast(reason instanceof Error ? reason.message : "Could not save the SLA.") }
          }}>
            <label className="field"><span>Name</span><input className="control" value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label className="field"><span>Response minutes</span><input className="control w-28" type="number" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /></label>
            <Button type="submit" variant="secondary">Save inactive threshold</Button>
            <Button type="button" variant="secondary" onClick={async () => { try { const result = await api<{ message: string }>("/api/v1/sla/run", { method: "POST", body: "{}" }); toast(result.message); reload() } catch (reason) { toast(reason instanceof Error ? reason.message : "Sweep failed.") } }}>Run escalation check</Button>
          </form>
          <div className="table-wrap"><table className="data"><thead><tr><th>Configuration</th><th>Response</th><th>State</th><th>Notes</th><th></th></tr></thead><tbody>
            {data.configs.map((config) => <tr key={config.id}><td>{config.name}{config.provisional ? <div className="text-xs text-warning">Pending validation</div> : null}</td><td>{config.responseMinutes ?? "—"} min</td><td><Badge tone={config.active ? "warning" : "neutral"}>{config.active ? "Active" : "Inactive"}</Badge></td><td>{config.notes}</td><td><button className="text-accent" type="button" onClick={async () => { await api("/api/v1/sla", { method: "POST", body: JSON.stringify({ ...config, active: !config.active, graceMinutes: 0 }) }); reload() }}>{config.active ? "Disable" : "Enable"}</button></td></tr>)}
          </tbody></table></div>
          <section><h2 className="mb-2 text-sm font-semibold">Escalation events</h2>{data.events.length ? data.events.map((event) => <p key={event.id} className="text-sm"><Badge tone={statusTone(event.type)}>{event.type}</Badge> {event.reference} — {event.message}</p>) : <p className="text-sm text-muted">No escalation events yet.</p>}</section>
        </div>
      ) : null}
    </div>
  )
}
