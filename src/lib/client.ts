"use client"

import { useEffect, useState } from "react"

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json")
  }
  const response = await fetch(path, { ...init, headers })
  const type = response.headers.get("content-type") || ""
  if (type.includes("spreadsheet") || type.includes("octet-stream")) {
    if (!response.ok) throw new Error("The export could not be created.")
    return response as T
  }
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.ok) throw new Error(body?.error?.message || "The request could not be completed.")
  return body.data as T
}

export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(path))
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!path) return
    let active = true
    api<T>(path)
      .then((result) => {
        if (!active) return
        setData(result)
        setError(null)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "The request failed.")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [path, version])

  return {
    data,
    error,
    loading,
    reload: () => {
      setLoading(true)
      setVersion((value) => value + 1)
    },
  }
}
