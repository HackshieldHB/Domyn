"use client"

import { useResource } from "@/lib/client"
import { Badge, Empty, ErrorNote, Loading, statusTone } from "@/components/ui"

type Location = { id: string; code: string; name: string; buildingName: string; floorName: string; connectionType: string; powerPreparation: string; active: boolean; supervisorName: string | null; deviceCount: number }
type Device = { id: string; code: string; name: string; status: string; connectionType: string; locationName: string; buildingName: string; lastSeenAt: string | null; lastSyncAt: string | null; lastSyncError: string | null; pendingOfflineCount: number; clockDriftMs: number | null }

export function LocationsPage() {
  const { data, error, loading } = useResource<Location[]>("/api/v1/locations")
  const buildings = new Map<string, Location[]>()
  for (const location of data ?? []) {
    const list = buildings.get(location.buildingName) ?? []
    list.push(location)
    buildings.set(location.buildingName, list)
  }
  return (
    <div>
      <p className="kicker">Facilities</p>
      <h1 className="text-lg font-semibold">Locations</h1>
      <p className="mb-4 text-[13px] text-muted">Grouped by building. Power notes are installation comments, not a readiness sign-off. The schema is building, floor, and restroom — not a drawn map.</p>
      {loading ? <Loading /> : null}
      {error ? <ErrorNote message={error} /> : null}
      {data && !data.length ? <Empty title="No locations" body="Add a building floor and restroom location before registering a tablet." /> : null}
      {[...buildings.entries()].map(([building, locations]) => (
        <section key={building} className="mb-6">
          <h2 className="border-b border-ink pb-1 text-sm font-semibold">{building}</h2>
          <div className="table-wrap"><table className="data">
            <thead><tr><th>Floor</th><th>Restroom</th><th>Code</th><th>Link</th><th>Power note</th><th>Supervisor</th><th>Tablets</th></tr></thead>
            <tbody>
              {locations.map((location) => <tr key={location.id}><td>{location.floorName}</td><td>{location.name}</td><td className="font-mono text-[12px]">{location.code}</td><td>{location.connectionType}</td><td>{location.powerPreparation}</td><td>{location.supervisorName || "—"}</td><td>{location.active ? location.deviceCount : "Inactive"}</td></tr>)}
            </tbody>
          </table></div>
        </section>
      ))}
    </div>
  )
}

export function DevicesPage() {
  const { data, error, loading } = useResource<Device[]>("/api/v1/devices")
  return (
    <div>
      <p className="kicker">Inventory</p>
      <h1 className="text-lg font-semibold">Devices</h1>
      <p className="mt-1 max-w-3xl text-[13px] text-muted">Registered means a record exists. Reachable means the derived status is Online or Sync pending. A sync error means it is not operating cleanly, even if it was seen recently.</p>
      {data ? <p className="mb-3 mt-2 text-[13px]">{data.length} registered · {data.filter((device) => device.status === "ONLINE" || device.status === "SYNC_PENDING").length} reachable · {data.filter((device) => device.lastSyncError).length} with a sync error</p> : null}
      {loading ? <Loading /> : null}
      {error ? <ErrorNote message={error} /> : null}
      {data && !data.length ? <Empty title="No devices" body="Register a tablet and open its kiosk URL." /> : null}
      {data && data.length ? <div className="table-wrap"><table className="data"><thead><tr><th>Device</th><th>Location</th><th>Registered</th><th>Reachable</th><th>Operating</th><th>Derived status</th><th>Last seen</th><th>Pending</th></tr></thead><tbody>
        {data.map((device) => {
          const reachable = device.status === "ONLINE" || device.status === "SYNC_PENDING"
          const operating = reachable && !device.lastSyncError
          return <tr key={device.id}><td>{device.name}<div className="font-mono text-[11px] text-muted">{device.code}</div></td><td>{device.buildingName}<div className="text-[11px] text-muted">{device.locationName}</div></td><td>Yes</td><td>{reachable ? "Yes" : "No"}</td><td>{operating ? "Yes" : "No"}{device.lastSyncError ? <div className="text-[11px] text-danger">{device.lastSyncError}</div> : null}</td><td><Badge tone={statusTone(device.status)}>{device.status.replaceAll("_", " ")}</Badge></td><td>{device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "—"}<div><a className="text-accent" href={`/kiosk/${device.code}`}>Kiosk</a></div></td><td>{device.pendingOfflineCount}{device.clockDriftMs && Math.abs(device.clockDriftMs) > 600000 ? <div className="text-[11px] text-warning">Clock drift</div> : null}</td></tr>
        })}
      </tbody></table></div> : null}
    </div>
  )
}
