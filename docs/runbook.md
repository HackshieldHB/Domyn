# Operational runbook

## Start and stop (local)

```powershell
docker compose up -d postgres
npm run dev
```

Stop the app with Ctrl+C. Stop Postgres with `docker compose stop postgres`.

## Health

`GET /api/health` returns ok when Prisma can query the database.

## Survey tablet

1. Register or confirm the device under Device Monitoring. The public URL is `/kiosk/{device code}`.
2. The tablet loads configuration from the server and caches it for a later offline open.
3. Ratings 4–5 submit immediately. Ratings 1–3 ask for reasons. Wording comes from Feedback Reason records.
4. The footer shows whether the tablet is offline and how many submissions are waiting.
5. Staff exit asks for the device PIN, then opens the login page. The PIN is not an admin password.

A heartbeat updates last-seen and connection state. Status shown in the console is derived from last heartbeat, pending count, and sync error: Online, Offline, Sync Pending, or Error.

## Complaints

Open a ticket from Complaint Tickets. Acknowledge moves it to In Progress. A comment after that records first progress. Resolve and Close are separate. Reassignment requires a reason and writes assignment history.

If no active staff member is on the location, the ticket stays visible to the configured supervisor fallback.

## Staff changes

Add an absence, then a replacement with effective start and end. Planned assignment rows stay in place. Routing uses the replacement while it is effective. Check-in is presence tagging only.

Schedule import accepts `.xlsx` or `.csv` with columns for staff code, location code, shift code, and work date. Invalid rows are returned in the import report and are not inserted.

## Notifications

The Notifications page lists each event, delivery mode, and attempt. Sandbox rows are simulated. Retry creates another attempt on the same notification; it does not create another complaint. A failed provider does not delete the ticket.

## Settings and decisions

System Settings changes are audited. Items marked pending validation are provisional. The Decisions page is the register for TLT approval. Adding a note there does not by itself change runtime behavior; change the related setting when a decision is approved.

## Audit

Audit Logs are append-only through the application. There is no user action to edit or delete them. Passwords and provider tokens are not written there.

## When something fails

- Survey sync error: open the device, read the last error, and confirm the device is active. Queued tablet items retry. Do not delete the tablet browser data unless the items have synced.
- Duplicate survey: the server returns the original submission when `clientSubmissionId` already exists.
- Login lockout: the in-memory limiter resets on process restart. A real lockout policy is not configured.
- Forgot password in production: an administrator sets a new password on the user record. Email delivery is not implemented.
