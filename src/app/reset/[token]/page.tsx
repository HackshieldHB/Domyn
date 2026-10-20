import { Suspense } from "react"
import { ResetForm } from "./reset-form"

export default function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center text-sm text-muted">Loading…</main>}>
      <Gate params={params} />
    </Suspense>
  )
}

async function Gate({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <ResetForm token={token} />
}
