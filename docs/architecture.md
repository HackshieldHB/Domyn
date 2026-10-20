# Architecture

DOMYN is a Next.js 16 App Router application. The browser talks to route handlers under `src/app/api`. Business rules live in `src/server`. PostgreSQL is accessed through Prisma 6.

## Request path

1. `src/proxy.ts` assigns `x-request-id` and redirects unsigned internal pages to `/login`. Public survey, auth, health, and job routes stay reachable. Cookie presence is not authorization.
2. Session lookup hashes the `domyn_session` cookie and loads the user, role permissions, and area access.
3. Mutating requests must come from the same origin.
4. Route handlers validate input with Zod, then call a service. Services enforce permissions and area scope again.

Public survey clients call `/api/public`. They never receive a session.

## Modules

| Area | Location |
|---|---|
| Survey ingest and sync | `src/server/feedback.ts` |
| Ticket lifecycle and routing | `src/server/complaints.ts`, `src/server/routing.ts` |
| Staff, shifts, absences, check-in | `src/server/workforce.ts` |
| Locations and devices | `src/server/assets.ts` |
| SLA sweep | `src/server/sla.ts` |
| Notifications | `src/server/notifications.ts` |
| Dashboard | `src/server/dashboard.ts` |
| Excel reports | `src/server/reports.ts` |
| Users, settings, audit, decisions | `src/server/admin.ts` |
| Pure rules | `src/server/domain.ts` |

## Time

Timestamps are stored in UTC. Display uses `app.timezone` (`APP_TIMEZONE`, default `Asia/Jakarta`). Work dates on assignments are calendar dates. Feedback keeps the device event time separate from the server receipt time. A device clock more than the configured drift window ahead of the server is rejected.

## Complaint rules in force for development

These are provisional until the Decisions register is approved:

- Ratings at or below `survey.negativeMaxRating` (default 3) create tickets.
- Ticket policy `tickets.policy` defaults to `PER_SUBMISSION`.
- Status path: New → Assigned → In Progress → Resolved → Closed. Assigned cannot skip to Resolved.
- Acknowledgement time is the first move into In Progress. First progress time is a later comment while In Progress. Closing does not set resolution time.
- Routing uses an active replacement before the planned assignment. If a replacement exists but the person is unavailable, the ticket uses the supervisor fallback and does not fall through to the planned person.
- Check-in records presence. It is not evidence that cleaning was completed.
- SLA configuration is inactive by default. The dashboard overdue count stays at zero until an active configuration exists. The seeded 20-minute example is inactive and is not an approved SLA.
- Escalation runs only when `sla.escalationEnabled` is true. The job is `POST /api/jobs/sla` with `Authorization: Bearer $CRON_SECRET`, or `npm run job:sla`.
- Similar-complaint grouping is off by default.

## Notifications

`queueNotification` writes one notification per dedupe key. Dispatch runs after the ticket transaction commits, so a provider failure does not roll back the complaint. Sandbox attempts are labeled simulated. Real WhatsApp delivery is not claimed unless the live provider returns success.

## Offline survey

The kiosk writes each submission to IndexedDB (`domyn-kiosk` / `queue`) before upload. Each item has a UUID `clientSubmissionId`. The server unique constraint makes a replay return the original row. The queue retries with backoff and keeps failed items.

## Authorization

Roles are Admin, Supervisor, Staff, and Management. Permissions are rows, not hardcoded checks in the UI. Supervisors and staff are limited to buildings in `UserAreaAccess`. A management user with no area rows can read all operational data; that empty-access behavior is provisional and recorded as a decision.

## Entity relationships

```mermaid
erDiagram
  User ||--o{ Session : has
  User }o--|| Role : assigned
  Role ||--o{ RolePermission : grants
  Permission ||--o{ RolePermission : granted
  User ||--o{ UserAreaAccess : scoped
  Building ||--o{ Floor : contains
  Floor ||--o{ RestroomLocation : contains
  RestroomLocation ||--o{ Device : hosts
  Device ||--o{ DeviceHeartbeat : reports
  Device ||--o{ FeedbackSubmission : collects
  FeedbackSubmission ||--o{ FeedbackSubmissionReason : selects
  FeedbackReason ||--o{ FeedbackSubmissionReason : used
  FeedbackSubmission ||--o{ TicketFeedbackLink : opens
  ComplaintTicket ||--o{ TicketFeedbackLink : from
  ComplaintTicket ||--o{ TicketReason : cites
  ComplaintTicket ||--o{ TicketStatusHistory : transitions
  ComplaintTicket ||--o{ TicketAssignmentHistory : routes
  ComplaintTicket ||--o{ TicketComment : notes
  ComplaintTicket ||--o{ TicketEvent : records
  ComplaintTicket }o--o| ComplaintGroup : grouped
  ComplaintTicket }o--o| Staff : assigned
  Staff ||--o{ StaffAreaCoverage : covers
  Staff ||--o{ PlannedAssignment : planned
  Staff ||--o{ StaffReplacement : replaces
  Staff ||--o{ StaffAbsence : absent
  Staff ||--o{ StaffCheckIn : tags
  Shift ||--o{ PlannedAssignment : schedules
  RestroomLocation ||--o{ PlannedAssignment : staffed
  RestroomLocation ||--o{ StaffCheckIn : tagged
  ComplaintTicket ||--o{ Notification : alerts
  Notification ||--o{ NotificationRecipient : to
  Notification ||--o{ NotificationAttempt : tries
  SlaConfiguration ||--o{ SlaEvent : evaluates
  User ||--o{ AuditLog : acts
  Decision ||--o{ DecisionHistory : annotated
```

Indexes, foreign keys, and uniqueness constraints are in `prisma/schema.prisma` and the migration `20261020041040_init`.
