"use client"

import { useState } from "react"
import { api, useResource } from "@/lib/client"
import { Button, ErrorNote, Loading, useToast } from "@/components/ui"

type UserRow = { id: string; name: string; email: string; roleKey: string; roleName: string; active: boolean; areaAccess: Array<{ buildingId: string | null }> }

export default function UsersPage() {
  const { data, error, loading, reload } = useResource<UserRow[]>("/api/v1/users")
  const toast = useToast()
  const [form, setForm] = useState({ name: "", email: "", roleKey: "STAFF", password: "", active: true, buildingIds: "" })
  return (
    <div>
      <p className="kicker">Access</p>
      <h1 className="text-lg font-semibold">Users</h1>
      <p className="mb-3 text-[13px] text-muted">The server rejects unauthorized calls even if a control is visible.</p>
      {loading ? <Loading /> : null}
      {error ? <ErrorNote message={error} /> : null}
      <form className="mb-4 grid gap-2 border-y border-line bg-surface px-2 py-2 md:grid-cols-3" onSubmit={async (event) => {
        event.preventDefault()
        try {
          await api("/api/v1/users", { method: "POST", body: JSON.stringify({ ...form, buildingIds: form.buildingIds.split(",").map((item) => item.trim()).filter(Boolean) }) })
          toast("User saved.")
          reload()
        } catch (reason) { toast(reason instanceof Error ? reason.message : "Could not save the user.") }
      }}>
        <input className="control" placeholder="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
        <input className="control" placeholder="Email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
        <select className="control" value={form.roleKey} onChange={(event) => setForm({ ...form, roleKey: event.target.value })}><option>ADMIN</option><option>SUPERVISOR</option><option>STAFF</option><option>MANAGEMENT</option></select>
        <input className="control" placeholder="Temporary password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required />
        <input className="control" placeholder="Building IDs, comma separated" value={form.buildingIds} onChange={(event) => setForm({ ...form, buildingIds: event.target.value })} />
        <Button type="submit">Create user</Button>
      </form>
      {data ? <div className="table-wrap"><table className="data"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Access</th><th>Status</th></tr></thead><tbody>
        {data.map((user) => <tr key={user.id}><td>{user.name}</td><td>{user.email}</td><td>{user.roleName}</td><td>{user.areaAccess.length ? `${user.areaAccess.length} building grants` : user.roleKey === "ADMIN" || user.roleKey === "MANAGEMENT" ? "All areas (provisional for management)" : "No areas granted"}</td><td>{user.active ? "Active" : "Inactive"}</td></tr>)}
      </tbody></table></div> : null}
    </div>
  )
}
