"use client"

import { api, useResource } from "@/lib/client"
import { Badge, Button, ErrorNote, Loading, useToast } from "@/components/ui"

type Notes = { provider: string; items: Array<{ id: string; eventType: string; status: string; mode: string; simulated: boolean; reference: string | null; createdAt: string; attempts: Array<{ success: boolean; simulated: boolean; error: string | null; attemptedAt: string }> }> }

export default function NotificationsPage() {
  const { data, error, loading, reload } = useResource<Notes>("/api/v1/notifications")
  const toast = useToast()
  return (
    <div>
      <p className="kicker">{data?.provider === "whatsapp" ? "Provider selected" : "Sandbox"}</p>
      <h1 className="mb-3 text-lg font-semibold">Notifications</h1>
      <p className="mb-3 text-[13px] text-muted">{data?.provider === "whatsapp" ? "Delivery still depends on credentials and an approved template." : "These rows were logged locally. WhatsApp was not contacted."}</p>
      {loading ? <Loading /> : null}
      {error ? <ErrorNote message={error} /> : null}
      {data ? <div className="table-wrap"><table className="data"><thead><tr><th>Event</th><th>Ticket</th><th>Status</th><th>Mode</th><th>Last attempt</th><th></th></tr></thead><tbody>
        {data.items.map((item) => <tr key={item.id}><td>{item.eventType}</td><td>{item.reference || "—"}</td><td><Badge tone={item.simulated ? "warning" : item.status === "SENT" ? "success" : item.status === "FAILED" ? "danger" : "warning"}>{item.simulated ? "Sandbox logged" : item.status}</Badge></td><td>{item.simulated ? "Delivery not confirmed" : item.mode}</td><td>{item.attempts[0] ? `${item.attempts[0].simulated ? "Simulated" : item.attempts[0].success ? "Accepted" : "Failed"} ${item.attempts[0].error || ""}` : "—"}</td><td><Button variant="secondary" onClick={async () => { try { const result = await api<{ simulated: boolean }>(`/api/v1/notifications/${item.id}/retry`, { method: "POST", body: "{}" }); toast(result.simulated ? "Retry recorded in the sandbox. WhatsApp was not contacted." : "Retry completed."); reload() } catch (reason) { toast(reason instanceof Error ? reason.message : "Retry failed.") } }}>Retry</Button></td></tr>)}
      </tbody></table></div> : null}
    </div>
  )
}
