import { Suspense } from "react"
import { Kiosk } from "@/components/kiosk"

export default function KioskPage({ params }: { params: Promise<{ code: string }> }) {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center text-sm text-muted">Loading survey…</main>}>
      <Gate params={params} />
    </Suspense>
  )
}

async function Gate({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return <Kiosk code={code} />
}
