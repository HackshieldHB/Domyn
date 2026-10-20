"use client"

import { useState } from "react"
import { api, useResource } from "@/lib/client"
import { Badge, Button, ErrorNote, Loading, useToast } from "@/components/ui"

type CheckIns = {
  meaning: string
  items: Array<{ id: string; staffName: string; employeeCode: string; locationName: string; method: string; checkedInAt: string; matchesAssignment: boolean }>
  missing: Array<{ staffName: string; locationName: string; shiftName: string; date: string }>
}

export default function CheckInPage() {
  const { data, error, loading, reload } = useResource<CheckIns>("/api/v1/checkins")
  const toast = useToast()
  const [form, setForm] = useState({ staffId: "", locationId: "", method: "TABLET", notes: "" })
  return (
    <div>
      <p className="kicker">Presence only</p>
      <h1 className="text-lg font-semibold">Check in</h1>
      <p className="mb-3 text-[13px] text-muted">{data?.meaning || "This records presence. It does not show that cleaning was completed."}</p>
      <form className="mb-5 flex flex-wrap items-end gap-2 border-y border-line bg-surface px-2 py-2" onSubmit={async (event) => {
        event.preventDefault()
        try {
          const result = await api<{ matchesAssignment: boolean; meaning: string }>("/api/v1/checkins", { method: "POST", body: JSON.stringify(form) })
          toast(result.matchesAssignment ? "Checked in. The location matches an active assignment." : "Checked in. The location does not match the expected assignment.")
          reload()
        } catch (reason) { toast(reason instanceof Error ? reason.message : "Check-in failed.") }
      }}>
        <input className="control min-w-64 flex-1" placeholder="Staff ID, if recording for someone else" value={form.staffId} onChange={(event) => setForm({ ...form, staffId: event.target.value })} />
        <input className="control min-w-40" placeholder="Location ID" value={form.locationId} onChange={(event) => setForm({ ...form, locationId: event.target.value })} required />
        <select className="control" value={form.method} onChange={(event) => setForm({ ...form, method: event.target.value })}><option>TABLET</option><option>MOBILE</option><option>MANUAL</option></select>
        <input className="control min-w-40 flex-1" placeholder="Notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        <Button type="submit">Check in</Button>
      </form>
      {loading ? <Loading /> : null}
      {error ? <ErrorNote message={error} /> : null}
      {data ? (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="table-wrap"><table className="data"><thead><tr><th>Staff</th><th>Location</th><th>Method</th><th>Time</th><th>Matches assignment</th></tr></thead><tbody>
            {data.items.map((item) => <tr key={item.id}><td>{item.staffName}<div className="text-xs text-muted">{item.employeeCode}</div></td><td>{item.locationName}</td><td>{item.method}</td><td>{new Date(item.checkedInAt).toLocaleString()}</td><td><Badge tone={item.matchesAssignment ? "success" : "warning"}>{item.matchesAssignment ? "Expected area" : "Different area"}</Badge></td></tr>)}
          </tbody></table></div>
          <section><h2 className="mb-2 text-sm font-semibold">Missing today</h2><ul className="divide-y divide-line border-y border-line text-[13px]">{data.missing.length ? data.missing.map((item) => <li key={`${item.staffName}-${item.locationName}`} className="py-1.5">{item.staffName}<span className="block text-[11px] text-muted">{item.locationName} · {item.shiftName}</span></li>) : <li className="py-2 text-muted">No missing check-ins for the planned assignments loaded today.</li>}</ul></section>
        </div>
      ) : null}
    </div>
  )
}
