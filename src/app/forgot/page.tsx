"use client"

import { useState } from "react"
import { api } from "@/lib/client"
import { Button, ErrorNote } from "@/components/ui"

export default function ForgotPage() {
  const [email, setEmail] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [resetPath, setResetPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4">
      <form className="w-full max-w-sm" onSubmit={async (event) => {
        event.preventDefault()
        setError(null)
        try {
          const result = await api<{ message: string; resetPath?: string }>("/api/auth?action=forgot", { method: "POST", body: JSON.stringify({ email }) })
          setMessage(result.message)
          setResetPath(result.resetPath ?? null)
        } catch (reason) { setError(reason instanceof Error ? reason.message : "Request failed.") }
      }}>
        <p className="kicker">DOMYN</p>
        <h1 className="mt-2 text-2xl font-semibold">Reset password</h1>
        <p className="mt-1 text-sm text-muted">Email delivery is not configured. Production resets are completed by an administrator.</p>
        <label className="field mt-4"><span>Email</span><input className="control" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        {error ? <div className="mt-3"><ErrorNote message={error} /></div> : null}
        {message ? <p className="mt-3 text-sm">{message}</p> : null}
        {resetPath ? <a className="mt-2 inline-block text-sm text-accent" href={resetPath}>Open the local reset link</a> : null}
        <div className="mt-4"><Button type="submit">Request reset</Button></div>
      </form>
    </main>
  )
}
