"use client"

import { useState } from "react"
import { useResource } from "@/lib/client"
import { Button, ErrorNote, Loading, useToast } from "@/components/ui"

export default function ReportsPage() {
  const { data, error, loading } = useResource<Array<{ id: string; name: string }>>("/api/v1/reports")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const toast = useToast()
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3"><div><p className="kicker">Exports</p><h1 className="text-lg font-semibold">Reports</h1><p className="text-[13px] text-muted">Each file contains only records this account can access.</p></div><div className="flex gap-2"><input className="control" type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From" /><input className="control" type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To" /></div></div>
      {loading ? <Loading /> : null}
      {error ? <ErrorNote message={error} /> : null}
      <div className="divide-y divide-line border-y border-line bg-surface">
        {data?.map((report) => (
          <div key={report.id} className="flex items-center justify-between px-3 py-2">
            <span className="text-[13px]">{report.name}</span>
            <Button variant="secondary" onClick={async () => {
              const params = new URLSearchParams()
              if (from) params.set("from", from)
              if (to) params.set("to", to)
              try {
                const response = await fetch(`/api/v1/reports/${report.id}/export?${params.toString()}`)
                if (!response.ok) {
                  const body = await response.json().catch(() => null)
                  throw new Error(body?.error?.message || "Export failed.")
                }
                const blob = await response.blob()
                const url = URL.createObjectURL(blob)
                const link = document.createElement("a")
                link.href = url
                link.download = `domyn-${report.id}.xlsx`
                link.click()
                URL.revokeObjectURL(url)
              } catch (reason) { toast(reason instanceof Error ? reason.message : "Export failed.") }
            }}>Export Excel</Button>
          </div>
        ))}
      </div>
    </div>
  )
}
