"use client"

import { useResource } from "@/lib/client"
import { ErrorNote, Loading } from "@/components/ui"

type Audit = { items: Array<{ id: string; createdAt: string; actor: string; action: string; entityType: string; entityId: string; reason: string | null }> }

export default function AuditPage() {
  const { data, error, loading } = useResource<Audit>("/api/v1/audit")
  return (
    <div>
      <p className="kicker">Read only</p>
      <h1 className="mb-3 text-lg font-semibold">Audit</h1>
      {loading ? <Loading /> : null}
      {error ? <ErrorNote message={error} /> : null}
      {data ? <div className="table-wrap"><table className="data"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Record</th><th>Reason</th></tr></thead><tbody>
        {data.items.map((item) => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleString()}</td><td>{item.actor}</td><td>{item.action}</td><td>{item.entityType}</td><td>{item.reason || "—"}</td></tr>)}
      </tbody></table></div> : null}
    </div>
  )
}
