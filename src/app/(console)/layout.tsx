import { Suspense } from "react"
import { Shell } from "@/components/shell"
import { requireUser } from "@/lib/auth"
import { getSettings } from "@/server/settings"

export const instant = false

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted">Loading DOMYN…</div>}>
      <Frame>{children}</Frame>
    </Suspense>
  )
}

async function Frame({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const settings = await getSettings()
  return <Shell user={user} dataLabel={String(settings["app.dataLabel"] || "")}>{children}</Shell>
}
