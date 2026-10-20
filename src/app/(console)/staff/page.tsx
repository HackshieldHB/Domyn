"use client"

import { useState } from "react"
import { api, useResource } from "@/lib/client"
import { Button, Dialog, Empty, ErrorNote, Loading, useToast } from "@/components/ui"

type StaffList = { items: Array<{ id: string; employeeCode: string; name: string; designation: string; active: boolean; phone: string | null; email: string | null; coverage: Array<{ locationName: string }> }> }

export default function StaffPage() {
  const { data, error, loading, reload } = useResource<StaffList>("/api/v1/staff")
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ employeeCode: "", name: "", designation: "Housekeeping Attendant", phone: "", email: "", active: true, locationIds: "" })
  return (
    <div>
      <div className="mb-3 flex items-end justify-between border-b border-line pb-3"><div><p className="kicker">Directory</p><h1 className="text-lg font-semibold">Staff</h1><p className="text-[13px] text-muted">Phone numbers stay hidden without staff management permission.</p></div><Button onClick={() => setOpen(true)}>Add staff</Button></div>
      {loading ? <Loading /> : null}
      {error ? <ErrorNote message={error} /> : null}
      {data && !data.items.length ? <Empty title="No staff" body="Add housekeeping staff before building the schedule." /> : null}
      {data && data.items.length ? (
        <div className="table-wrap"><table className="data"><thead><tr><th>ID</th><th>Name</th><th>Designation</th><th>Phone</th><th>Status</th><th>Areas</th></tr></thead><tbody>
          {data.items.map((staff) => <tr key={staff.id}><td className="font-mono text-[12px]">{staff.employeeCode}</td><td><span className="mr-2 inline-grid h-6 w-6 place-items-center bg-[#eceae4] text-[10px] font-semibold">{staff.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</span>{staff.name}</td><td>{staff.designation}</td><td>{staff.phone || "—"}</td><td>{staff.active ? "Active" : "Inactive"}</td><td>{staff.coverage.map((item) => item.locationName).join(", ") || "—"}</td></tr>)}
        </tbody></table></div>
      ) : null}
      <Dialog open={open} title="Add staff" onClose={() => setOpen(false)}>
        <form className="space-y-3" onSubmit={async (event) => {
          event.preventDefault()
          try {
            await api("/api/v1/staff", { method: "POST", body: JSON.stringify({ ...form, phone: form.phone || null, email: form.email || null, locationIds: form.locationIds.split(",").map((item) => item.trim()).filter(Boolean) }) })
            toast("Staff member saved.")
            setOpen(false)
            reload()
          } catch (reason) { toast(reason instanceof Error ? reason.message : "Save failed.") }
        }}>
          <label className="field"><span>Employee ID</span><input className="control" value={form.employeeCode} onChange={(event) => setForm({ ...form, employeeCode: event.target.value })} required /></label>
          <label className="field"><span>Name</span><input className="control" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
          <label className="field"><span>Designation</span><input className="control" value={form.designation} onChange={(event) => setForm({ ...form, designation: event.target.value })} required /></label>
          <label className="field"><span>Phone</span><input className="control" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
          <label className="field"><span>Location IDs, comma separated</span><input className="control" value={form.locationIds} onChange={(event) => setForm({ ...form, locationIds: event.target.value })} /></label>
          <Button type="submit">Save</Button>
        </form>
      </Dialog>
    </div>
  )
}
