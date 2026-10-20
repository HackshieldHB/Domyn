"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState, type ReactNode } from "react"
import {
  Bell,
  Building2,
  CalendarDays,
  ClipboardCheck,
  FileBarChart,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeft,
  Scale,
  ScrollText,
  Settings,
  Shield,
  Tablet,
  Ticket,
  Timer,
  Users,
  type LucideIcon,
} from "lucide-react"
import { api } from "@/lib/client"
import { ToastProvider } from "@/components/ui"
import type { SessionUser } from "@/lib/permissions"

const NAV: Array<{ group: string; items: Array<[string, string, string, LucideIcon]> }> = [
  { group: "Overview", items: [["/overview", "Dashboard", "dashboard.view", LayoutDashboard]] },
  { group: "Building operations", items: [
    ["/feedback", "Feedback", "feedback.view", Building2],
    ["/tickets", "Tickets", "tickets.view", Ticket],
    ["/check-in", "Check-in", "checkin.view", ClipboardCheck],
    ["/locations", "Locations", "locations.view", Building2],
    ["/devices", "Devices", "devices.view", Tablet],
  ]},
  { group: "People and services", items: [
    ["/staff", "Staff", "staff.view", Users],
    ["/shifts", "Shifts", "shifts.view", CalendarDays],
  ]},
  { group: "Performance", items: [
    ["/sla", "SLA", "sla.view", Timer],
    ["/notifications", "Notifications", "notifications.view", Bell],
    ["/reports", "Reports", "reports.view", FileBarChart],
  ]},
  { group: "Administration", items: [
    ["/users", "Users and access", "users.manage", Shield],
    ["/audit", "Audit logs", "audit.view", ScrollText],
    ["/settings", "Settings", "settings.manage", Settings],
    ["/decisions", "Decision register", "decisions.view", Scale],
  ]},
]

const CRUMB: Record<string, string> = {
  "/overview": "Dashboard",
  "/feedback": "Feedback",
  "/tickets": "Tickets",
  "/check-in": "Check-in",
  "/locations": "Locations",
  "/devices": "Devices",
  "/staff": "Staff",
  "/shifts": "Shifts",
  "/sla": "SLA",
  "/notifications": "Notifications",
  "/reports": "Reports",
  "/users": "Users and access",
  "/audit": "Audit logs",
  "/settings": "Settings",
  "/decisions": "Decision register",
}

export function Shell({ user, dataLabel, children }: { user: SessionUser; dataLabel: string; children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const canNotify = user.permissions.includes("notifications.view")
  const crumbs = breadcrumbs(pathname)

  async function signOut() {
    await api("/api/auth?action=logout", { method: "POST" })
    router.push("/login")
    router.refresh()
  }

  return (
    <ToastProvider>
      <div className="min-h-screen bg-canvas text-ink">
        {open ? <button type="button" className="fixed inset-0 z-20 bg-[#1c2430]/40 md:hidden" aria-label="Close navigation" onClick={() => setOpen(false)} /> : null}
        <div className="flex min-h-screen">
          <aside className={`${open ? "translate-x-0" : "-translate-x-full"} fixed inset-y-0 z-30 flex w-56 flex-col border-r border-line bg-[#eceae4] transition-transform md:static md:translate-x-0 ${collapsed ? "md:w-14" : "md:w-56"}`}>
            <div className="flex h-12 items-center gap-2 border-b border-line px-3">
              <Link href="/overview" className="flex min-w-0 items-center gap-2" onClick={() => setOpen(false)}>
                <span className="h-3.5 w-3.5 shrink-0 border border-accent bg-accent-soft" aria-hidden />
                {collapsed ? null : <span className="truncate text-[13px] font-semibold tracking-[0.16em]">DOMYN</span>}
              </Link>
            </div>
            <nav className="flex-1 space-y-4 overflow-y-auto p-2" aria-label="Primary">
              {NAV.map((group) => {
                const items = group.items.filter((item) => user.permissions.includes(item[2]))
                if (!items.length) return null
                return (
                  <div key={group.group}>
                    {collapsed ? null : <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{group.group}</p>}
                    {items.map(([href, label, , Icon]) => {
                      const active = pathname === href || pathname.startsWith(`${href}/`)
                      return (
                        <Link key={href} href={href} title={label} onClick={() => setOpen(false)} className={`mb-px flex items-center gap-2 border-l-2 px-2 py-1.5 text-[13px] ${active ? "border-accent bg-white font-medium text-accent" : "border-transparent text-ink hover:bg-white/70"} ${collapsed ? "justify-center" : ""}`}>
                          <Icon size={16} aria-hidden />
                          {collapsed ? <span className="sr-only">{label}</span> : label}
                        </Link>
                      )
                    })}
                  </div>
                )
              })}
            </nav>
            <div className="border-t border-line p-2">
              <button type="button" className="flex w-full items-center gap-2 px-2 py-2 text-left text-[13px] hover:bg-white/70" onClick={() => setAccountOpen((value) => !value)} aria-expanded={accountOpen}>
                <span className="grid h-7 w-7 shrink-0 place-items-center bg-accent text-[10px] font-semibold text-white">{initials(user.name)}</span>
                {collapsed ? null : <span className="min-w-0"><span className="block truncate font-medium">{user.name}</span><span className="block truncate text-xs text-muted">{user.roleName}</span></span>}
              </button>
              {accountOpen ? (
                <button type="button" className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-muted hover:bg-[#f6f3ed]" onClick={() => void signOut()}>
                  <LogOut size={16} aria-hidden />
                  {collapsed ? <span className="sr-only">Sign out</span> : "Sign out"}
                </button>
              ) : null}
            </div>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-12 items-center justify-between gap-3 border-b border-line bg-surface px-3 md:px-4">
              <div className="flex min-w-0 items-center gap-2">
                <button type="button" className="rounded-md p-2 md:hidden" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu size={18} /></button>
                <button type="button" className="hidden rounded-md p-2 text-muted hover:bg-[#f6f3ed] md:inline-flex" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}><PanelLeft size={18} /></button>
                <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm text-muted">
                  {crumbs.map((crumb, index) => (
                    <span key={crumb.href} className="flex min-w-0 items-center gap-1">
                      {index > 0 ? <span aria-hidden>/</span> : null}
                      {index === crumbs.length - 1 ? <span className="truncate font-medium text-ink">{crumb.label}</span> : <Link href={crumb.href} className="truncate hover:text-ink">{crumb.label}</Link>}
                    </span>
                  ))}
                </nav>
              </div>
              <div className="flex items-center gap-2">
                {canNotify ? <Link href="/notifications" className="rounded-md p-2 text-muted hover:bg-[#f6f3ed]" aria-label="Notifications"><Bell size={18} /></Link> : null}
              </div>
            </header>
            {dataLabel ? <div className="border-b border-warning/20 bg-warning-soft px-4 py-2 text-sm text-warning">{dataLabel}. Figures on these screens come from the database, not from a live production site.</div> : null}
            <main className="flex-1 px-3 py-4 md:px-5">{children}</main>
          </div>
        </div>
      </div>
    </ToastProvider>
  )
}

function breadcrumbs(pathname: string) {
  const root = Object.keys(CRUMB).find((href) => pathname === href || pathname.startsWith(`${href}/`))
  if (!root) return [{ href: "/overview", label: "DOMYN" }]
  if (pathname === root) return [{ href: root, label: CRUMB[root] }]
  return [{ href: root, label: CRUMB[root] }, { href: pathname, label: "Detail" }]
}

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "D"
}
