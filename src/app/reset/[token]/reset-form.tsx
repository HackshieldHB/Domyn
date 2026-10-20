"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { api } from "@/lib/client"
import { Button, ErrorNote } from "@/components/ui"

export function ResetForm({ token }: { token: string }) {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4">
      <form className="w-full max-w-sm" onSubmit={async (event) => {
        event.preventDefault()
        try {
          await api("/api/auth?action=reset", { method: "POST", body: JSON.stringify({ token, password }) })
          router.push("/login")
        } catch (reason) { setError(reason instanceof Error ? reason.message : "Reset failed.") }
      }}>
        <p className="kicker">DOMYN</p>
        <h1 className="mt-2 text-2xl font-semibold">Choose a new password</h1>
        <label className="field mt-4"><span>New password</span><input className="control" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error ? <div className="mt-3"><ErrorNote message={error} /></div> : null}
        <div className="mt-4"><Button type="submit">Update password</Button></div>
      </form>
    </main>
  )
}
