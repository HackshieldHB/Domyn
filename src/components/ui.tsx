"use client"

import { X } from "lucide-react"
import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

export function Button({
  children,
  variant = "primary",
  type = "button",
  disabled,
  onClick,
}: {
  children: ReactNode
  variant?: "primary" | "secondary" | "danger" | "ghost"
  type?: "button" | "submit"
  disabled?: boolean
  onClick?: () => void
}) {
  const styles = {
    primary: "bg-accent text-white hover:bg-[#155734]",
    secondary: "border border-line bg-white hover:bg-[#f7f6f2]",
    danger: "bg-danger text-white hover:bg-[#732622]",
    ghost: "text-muted hover:bg-black/5",
  }
  return (
    <button type={type} disabled={disabled} onClick={onClick} className={`inline-flex h-8 items-center justify-center gap-2 rounded-sm px-2.5 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]}`}>
      {children}
    </button>
  )
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "info" | "success" | "warning" | "danger" }) {
  const styles = {
    neutral: "bg-[#efece6] text-[#3d4652]",
    info: "bg-info-soft text-info",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
  }
  const dot = {
    neutral: "bg-[#8b93a0]",
    info: "bg-info",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-[11px] font-medium ${styles[tone]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot[tone]}`} aria-hidden />
      {children}
    </span>
  )
}

export function statusTone(status: string) {
  if (status === "CLOSED" || status === "ONLINE" || status === "SYNCED" || status === "SENT" || status === "WITHIN") return "success" as const
  if (status === "RESOLVED" || status === "SYNC_PENDING" || status === "APPROACHING" || status === "WAITING_ACK") return "info" as const
  if (status === "IN_PROGRESS" || status === "OFFLINE" || status === "DELAYED_SYNC" || status === "DELAYED_NOTIFICATION" || status === "SANDBOX") return "warning" as const
  if (status === "NEW" || status === "OVERDUE" || status === "ERROR" || status === "FAILED" || status === "UNASSIGNED") return "danger" as const
  return "neutral" as const
}

export function Dialog({ open, title, children, onClose }: { open: boolean; title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#1c2430]/45 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="panel mt-16 w-full max-w-xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" className="rounded-md p-1 text-muted hover:bg-black/5" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

const ToastContext = createContext<(message: string) => void>(() => undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(null), 3600)
    return () => window.clearTimeout(timer)
  }, [message])
  return (
    <ToastContext.Provider value={setMessage}>
      {children}
      {message ? <div role="status" className="fixed bottom-4 right-4 z-50 max-w-sm rounded-md bg-ink px-3 py-2 text-sm text-white shadow-lg">{message}</div> : null}
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-surface px-4 py-12 text-center">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{body}</p>
    </div>
  )
}

export function Loading({ label = "Loading records…" }: { label?: string }) {
  return (
    <div className="panel px-4 py-6" role="status">
      <div className="h-3 w-40 rounded bg-[#ebe6dc]" />
      <div className="mt-3 h-3 w-64 rounded bg-[#f3efe8]" />
      <p className="mt-3 text-sm text-muted">{label}</p>
    </div>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return <div role="alert" className="rounded-md border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">{message}</div>
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-0.5 max-w-3xl text-[13px] text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function Panel({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="panel p-4">
      {title ? <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">{title}</h2>{action}</div> : null}
      {children}
    </section>
  )
}
