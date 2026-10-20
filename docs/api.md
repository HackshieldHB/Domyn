# API

Authenticated console calls use `/api/v1/...` with the session cookie. Public survey calls use `/api/public`. Responses are `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.

List endpoints accept `page` and `pageSize` (max 100). Operational lists also accept `from`, `to`, `buildingId`, `locationId`, `category`, `deviceId`, `status`, `reasonId`, and `staffId` where the service uses them.

## Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth` | Login `{ email, password }` |
| GET | `/api/auth` | Current user |
| POST | `/api/auth?action=logout` | End session |
| POST | `/api/auth?action=password` | Change password |
| POST | `/api/auth?action=forgot` | Development may return a reset path. Production does not. |
| POST | `/api/auth?action=reset` | `{ token, password }` |

## Public

| Method | Path | Notes |
|---|---|---|
| GET | `/api/public?code=` | Kiosk configuration for an active device |
| POST | `/api/public?action=sync` | Batch of feedback items, max 50, partial success |
| POST | `/api/public?action=heartbeat` | Device heartbeat |
| POST | `/api/public?action=unlock` | `{ deviceCode, pin }` checks the kiosk PIN |

## Console

All routes below are under `/api/v1`. Permission checks run on the server.

| Method | Path | Permission |
|---|---|---|
| GET | `/bootstrap` | Session |
| GET | `/dashboard` | `dashboard.view` |
| GET | `/feedback` | `feedback.view` |
| GET | `/tickets` | `tickets.view` |
| GET | `/tickets/:id` | `tickets.view` |
| POST | `/tickets/:id/transition` | Ticket permission for the target status |
| POST | `/tickets/:id/comments` | Ticket comment permission |
| POST | `/tickets/:id/assign` | Reassignment permission |
| POST | `/tickets/:id/priority` | Ticket manage permission |
| GET/POST | `/staff` | `staff.view` / `staff.manage` |
| GET | `/schedule?from=&to=` | `shifts.view` |
| POST | `/assignments` | `shifts.manage` |
| POST | `/assignments/import` | `shifts.manage`, multipart file |
| POST | `/absences` | `shifts.manage` |
| POST | `/replacements` | `shifts.manage` |
| GET/POST | `/checkins` | `checkin.view` / `checkin.manage` |
| POST | `/checkins/:id/correct` | `checkin.manage` |
| GET/POST | `/locations` | `locations.view` / `locations.manage` |
| GET | `/buildings` | Session |
| GET/POST | `/devices` | `devices.view` / `devices.manage` |
| GET | `/devices/:id/heartbeats` | `devices.view` |
| GET/POST | `/sla` | `sla.view` / `sla.manage` |
| POST | `/sla/run` | `sla.manage` |
| GET | `/notifications` | Notification view permission |
| POST | `/notifications/:id/retry` | `notifications.retry` |
| GET | `/reports` | `reports.view` |
| GET | `/reports/:type/export` | `reports.export` |
| GET/POST | `/users` | `users.manage` |
| GET | `/roles` | `users.manage` |
| PUT | `/roles/:key` | `users.manage` |
| GET | `/audit` | `audit.view` |
| GET | `/settings` | `settings.manage` |
| PUT | `/settings/:key` | `settings.manage` |
| GET | `/decisions` | `decisions.view` |
| POST | `/decisions/:id` | `decisions.manage` |
| GET/POST | `/reasons` | `settings.manage` |

## Jobs and health

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | Database ping |
| POST | `/api/jobs/sla` | Bearer `CRON_SECRET`, or a session with `sla.manage` |

Excel export returns a workbook, not JSON. Report types are the catalog returned by `GET /api/v1/reports`. Exports are capped at 10,000 rows and limited to the caller's area access.
