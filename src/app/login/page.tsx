"use client"

import { Eye, EyeOff } from "lucide-react"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { api } from "@/lib/client"
import { Button, ErrorNote } from "@/components/ui"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-[#143026] text-[#e7f3ec] lg:flex lg:flex-col lg:justify-between lg:p-12">
        <svg className="absolute left-0 top-0 h-[58%] w-full opacity-50" viewBox="0 0 640 520" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
          <rect x="80" y="70" width="280" height="520" />
          <rect x="80" y="70" width="130" height="180" />
          <rect x="210" y="70" width="150" height="180" />
          <rect x="80" y="250" width="280" height="160" />
          <rect x="80" y="410" width="140" height="180" />
          <rect x="220" y="410" width="140" height="180" />
          <path d="M400 120 H560 V640 H400 Z" />
          <path d="M400 120 H480 V300 H400 Z M480 120 H560 V300 H480 Z" />
          <path d="M400 300 H560 V640 H400 Z" />
        </svg>
        <p className="relative text-xs font-semibold tracking-[0.22em]">DOMYN</p>
        <div className="relative max-w-sm">
          <h1 className="text-3xl font-semibold leading-tight">Every building. One operational view.</h1>
          <p className="mt-4 text-sm text-[#e7f3ec]/80">Satisfaction, complaints, coverage, and device health in one floor-level workspace.</p>
        </div>
        <p className="relative text-xs tracking-wide text-[#e7f3ec]/70">Building operations</p>
      </section>
      <section className="flex items-center justify-center bg-canvas px-4 py-10">
        <form
          className="w-full max-w-md"
          onSubmit={async (event) => {
            event.preventDefault()
            setPending(true)
            setError(null)
            try {
              await api("/api/auth", { method: "POST", body: JSON.stringify({ email, password }) })
              router.push("/overview")
              router.refresh()
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : "Sign-in failed. Check the connection and try again.")
            } finally {
              setPending(false)
            }
          }}
        >
          <p className="text-xs font-semibold tracking-[0.16em] text-accent lg:hidden">DOMYN</p>
          <h2 className="mt-2 text-2xl font-semibold">Sign in</h2>
          <p className="mt-1 text-sm text-muted">Use your work email. Public survey tablets do not use this page.</p>
          <label className="field mt-6"><span>Work email</span><input className="control" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label className="field mt-3">
            <span>Password</span>
            <div className="relative">
              <input className="control w-full pr-10" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
              <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>
          {error ? <div className="mt-3"><ErrorNote message={error} /></div> : null}
          <div className="mt-5"><Button type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</Button></div>
          <a className="mt-4 inline-block text-sm text-accent" href="/forgot">Forgot password</a>
        </form>
      </section>
    </main>
  )
}
