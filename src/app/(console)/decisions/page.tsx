"use client"

import { useState } from "react"
import { api, useResource } from "@/lib/client"
import { Badge, Button, ErrorNote, Loading, useToast } from "@/components/ui"

type Decision = { id: string; code: string; topic: string; status: string; proposedDefault: string | null; owner: string; notes: string; history: Array<{ id: string; note: string; actor: string; createdAt: string; status: string }> }

export default function DecisionsPage() {
  const { data, error, loading, reload } = useResource<Decision[]>("/api/v1/decisions")
  const [note, setNote] = useState("")
  const toast = useToast()
  return (
    <div>
      <p className="kicker">Open decisions</p>
      <h1 className="mb-3 text-lg font-semibold">Decision register</h1>
      {loading ? <Loading /> : null}
      {error ? <ErrorNote message={error} /> : null}
      <div className="space-y-3">
        {data?.map((decision) => (
          <article key={decision.id} className="border-b border-line py-3">
            <div className="flex items-start justify-between gap-3"><h2 className="text-sm font-semibold">{decision.code} · {decision.topic}</h2><Badge tone={decision.status === "APPROVED" ? "success" : "warning"}>{decision.status}</Badge></div>
            <p className="mt-2 text-sm">Proposed default: {decision.proposedDefault}</p>
            <p className="text-xs text-muted">Owner: {decision.owner}</p>
            <p className="mt-2 text-sm text-muted">{decision.notes}</p>
            <ul className="mt-2 space-y-1 text-xs text-muted">{decision.history.map((item) => <li key={item.id}>{new Date(item.createdAt).toLocaleString()} · {item.actor}: {item.note}</li>)}</ul>
            <form className="mt-3 flex gap-2" onSubmit={async (event) => {
              event.preventDefault()
              try {
                await api(`/api/v1/decisions/${decision.id}`, { method: "POST", body: JSON.stringify({ note, status: decision.status }) })
                setNote("")
                toast("Note added. This does not mark the decision approved.")
                reload()
              } catch (reason) { toast(reason instanceof Error ? reason.message : "Could not add the note.") }
            }}>
              <input className="control flex-1" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a validation note" />
              <Button type="submit" variant="secondary">Add note</Button>
            </form>
          </article>
        ))}
      </div>
    </div>
  )
}
