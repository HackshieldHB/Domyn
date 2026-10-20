"use client"

import { useMemo, useState } from "react"
import { api, useResource } from "@/lib/client"
import { Button, ErrorNote, Loading, useToast } from "@/components/ui"

type Schedule = {
  from: string
  to: string
  assignments: Array<{ id: string; date: string; staffName: string; locationName: string; shiftName: string }>
  gaps: Array<{ date: string; locationName: string; shiftName: string }>
  gapCount: number
  absences: Array<{ id: string; staffName: string; type: string; startAt: string; endAt: string }>
  replacements: Array<{ id: string; originalStaffName: string; replacementStaffName: string; locationName: string; reason: string; effectiveFrom: string; effectiveTo: string }>
  shifts: Array<{ id: string; name: string }>
}

function isoDate(offset: number) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return date.toISOString().slice(0, 10)
}

export default function ShiftsPage() {
  const [from, setFrom] = useState(isoDate(-1))
  const [to, setTo] = useState(isoDate(6))
  const [tab, setTab] = useState<"schedule" | "absence">("schedule")
  const { data, error, loading, reload } = useResource<Schedule>(`/api/v1/schedule?from=${from}&to=${to}`)
  const toast = useToast()
  const days = useMemo(() => [...new Set(data?.assignments.map((item) => item.date) ?? [])], [data])
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3"><div><p className="kicker">Coverage</p><h1 className="text-lg font-semibold">Shifts</h1><p className="text-[13px] text-muted">A replacement does not erase the planned row.</p></div><div className="flex gap-2"><input className="control" type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From" /><input className="control" type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To" /></div></div>
      <div className="mb-3 flex gap-2">
        <Button variant={tab === "schedule" ? "primary" : "secondary"} onClick={() => setTab("schedule")}>Schedule</Button>
        <Button variant={tab === "absence" ? "primary" : "secondary"} onClick={() => setTab("absence")}>Absence and replacement</Button>
      </div>
      {loading ? <Loading /> : null}
      {error ? <ErrorNote message={error} /> : null}
      {data && tab === "schedule" ? (
        <div className="space-y-4">
          <form className="grid gap-2 border-y border-line bg-surface px-2 py-2 md:grid-cols-5" onSubmit={async (event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            try {
              await api("/api/v1/assignments", { method: "POST", body: JSON.stringify(Object.fromEntries(form.entries())) })
              toast("Assignment saved. Other assignments for this person were left unchanged.")
              reload()
            } catch (reason) { toast(reason instanceof Error ? reason.message : "Could not save the assignment.") }
          }}>
            <input className="control" name="staffId" placeholder="Staff ID" required />
            <input className="control" name="locationId" placeholder="Location ID" required />
            <input className="control" name="shiftId" placeholder="Shift ID" required />
            <input className="control" name="workDate" type="date" required />
            <Button type="submit">Add planned shift</Button>
          </form>
          <form className="border-b border-line py-3" onSubmit={async (event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            try {
              const result = await api<{ successCount: number; errorCount: number; errors: Array<{ row: number; message: string }> }>("/api/v1/assignments/import", { method: "POST", body: form })
              toast(`Imported ${result.successCount}. ${result.errorCount} row errors.`)
              reload()
            } catch (reason) { toast(reason instanceof Error ? reason.message : "Import failed.") }
          }}>
            <p className="text-sm font-medium">Excel or CSV import</p>
            <p className="text-xs text-muted">Columns: employeeCode, locationCode, shiftCode, workDate, notes.</p>
            <input className="mt-2 text-sm" type="file" name="file" accept=".xlsx,.csv" required />
            <div className="mt-2"><Button type="submit" variant="secondary">Import</Button></div>
          </form>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_260px]">
            <div className="table-wrap"><table className="data"><thead><tr><th>Date</th><th>Shift</th><th>Location</th><th>Staff</th></tr></thead><tbody>
              {data.assignments.map((item) => <tr key={item.id}><td>{item.date}</td><td>{item.shiftName}</td><td>{item.locationName}</td><td>{item.staffName}</td></tr>)}
            </tbody></table></div>
            <aside>
              <h2 className="text-sm font-semibold">Gaps</h2>
              <p className="mb-2 text-[12px] text-muted">{data.gapCount} in this range. {days.length} days have a planned assignment.</p>
              <ul className="divide-y divide-line border-y border-line text-[13px]">{data.gaps.slice(0, 12).map((gap) => <li key={`${gap.date}-${gap.locationName}-${gap.shiftName}`} className="py-1.5">{gap.date}<span className="block text-[11px] text-muted">{gap.locationName} · {gap.shiftName}</span></li>)}</ul>
            </aside>
          </div>
        </div>
      ) : null}
      {data && tab === "absence" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <form className="space-y-2 border border-line bg-surface p-3" onSubmit={async (event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            try {
              await api("/api/v1/absences", { method: "POST", body: JSON.stringify(Object.fromEntries(form.entries())) })
              toast("Absence recorded.")
              reload()
            } catch (reason) { toast(reason instanceof Error ? reason.message : "Could not record the absence.") }
          }}>
            <h2 className="text-sm font-semibold">Record absence</h2>
            <input className="control w-full" name="staffId" placeholder="Staff ID" required />
            <select className="control w-full" name="type"><option>SICK</option><option>PERMISSION</option><option>ABSENCE</option><option>OTHER</option></select>
            <input className="control w-full" name="startAt" type="datetime-local" required />
            <input className="control w-full" name="endAt" type="datetime-local" required />
            <input className="control w-full" name="notes" placeholder="Notes" />
            <Button type="submit">Save absence</Button>
          </form>
          <form className="space-y-2 border border-line bg-surface p-3" onSubmit={async (event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            try {
              await api("/api/v1/replacements", { method: "POST", body: JSON.stringify(Object.fromEntries(form.entries())) })
              toast("Replacement saved. The planned schedule was not overwritten.")
              reload()
            } catch (reason) { toast(reason instanceof Error ? reason.message : "Could not save the replacement.") }
          }}>
            <h2 className="text-sm font-semibold">Appoint replacement</h2>
            <input className="control w-full" name="originalStaffId" placeholder="Original staff ID" required />
            <input className="control w-full" name="replacementStaffId" placeholder="Replacement staff ID" required />
            <input className="control w-full" name="locationId" placeholder="Location ID" required />
            <input className="control w-full" name="reason" placeholder="Reason" required />
            <input className="control w-full" name="effectiveFrom" type="datetime-local" required />
            <input className="control w-full" name="effectiveTo" type="datetime-local" required />
            <Button type="submit">Save replacement</Button>
          </form>
          <div className="lg:col-span-2">
            <h2 className="mb-2 text-sm font-semibold">Current replacements</h2>
            {data.replacements.map((item) => <p key={item.id} className="text-sm">{item.replacementStaffName} covers {item.originalStaffName} at {item.locationName}. {item.reason}</p>)}
            <h2 className="mb-2 mt-4 text-sm font-semibold">Absences</h2>
            {data.absences.map((item) => <p key={item.id} className="text-sm">{item.staffName} · {item.type} · {new Date(item.startAt).toLocaleString()} to {new Date(item.endAt).toLocaleString()}</p>)}
          </div>
        </div>
      ) : null}
    </div>
  )
}
