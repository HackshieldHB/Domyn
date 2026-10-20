"use client"

import { api, useResource } from "@/lib/client"
import { Button, ErrorNote, Loading, useToast } from "@/components/ui"

type Setting = { key: string; label: string; description: string; provisional: boolean; value: unknown }

export default function SettingsPage() {
  const { data, error, loading, reload } = useResource<Setting[]>("/api/v1/settings")
  const toast = useToast()
  return (
    <div>
      <p className="kicker">Configuration</p>
      <h1 className="mb-3 text-lg font-semibold">Settings</h1>
      {loading ? <Loading /> : null}
      {error ? <ErrorNote message={error} /> : null}
      <div className="space-y-3">
        {data?.map((setting) => (
          <form key={setting.key} className="grid gap-3 border-b border-line py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end" onSubmit={async (event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            const raw = String(form.get("value"))
            try {
              await api(`/api/v1/settings/${encodeURIComponent(setting.key)}`, { method: "PUT", body: JSON.stringify({ value: typeof setting.value === "boolean" ? raw === "true" : typeof setting.value === "number" ? Number(raw) : raw }) })
              toast("Setting saved.")
              reload()
            } catch (reason) { toast(reason instanceof Error ? reason.message : "Could not save the setting.") }
          }}>
            <div>
              <div className="flex items-center gap-3"><h2 className="text-sm font-semibold">{setting.label}</h2>{setting.provisional ? <span className="text-xs text-warning">Pending validation</span> : null}</div>
              <p className="mt-1 text-xs text-muted">{setting.description}</p>
            </div>
            <div className="flex gap-2">
              {typeof setting.value === "boolean" ? <select className="control" name="value" defaultValue={String(setting.value)}><option value="true">Enabled</option><option value="false">Disabled</option></select> : <input className="control flex-1" name="value" defaultValue={String(setting.value ?? "")} />}
              <Button type="submit" variant="secondary">Save</Button>
            </div>
          </form>
        ))}
      </div>
    </div>
  )
}
