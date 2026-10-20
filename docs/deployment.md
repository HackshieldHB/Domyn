# Deployment

Hosting owner, availability targets, backup RPO/RTO, and capacity are not decided. See [pending decisions](pending-decisions.md). Do not treat the defaults below as an approved production standard.

## Process

The app is a Node server (`next start`) plus PostgreSQL 16. `next.config.ts` sets `output: "standalone"` and baseline security headers. HTTPS must be terminated in front of the app. Cookies are `Secure` when `NODE_ENV=production`.

## Database

```powershell
npx prisma migrate deploy
```

Run this before starting a new release. Do not run `db:seed` on a production database. The seed contains fictional people, a shared demo password, and a kiosk PIN.

Take backups with `pg_dump` on a schedule owned by the host. Restore with `pg_restore` or `psql` into an empty database, then run `prisma migrate deploy` if the dump predates a migration. Recovery time has not been measured.

## Environment

Set every variable in `.env.example`. Generate a long `CRON_SECRET`. Leave `EXPOSE_RESET_TOKEN` unset or `false`. Keep `WHATSAPP_PROVIDER=sandbox` until a vendor, sender, template, and token are approved. Store the token only in the environment, not in System Settings.

`APP_BASE_URL` is the public origin used in ticket links. `APP_TIMEZONE` is display only.

## Containers

PostgreSQL for local development:

```powershell
docker compose up -d postgres
```

The optional app image uses the `app` profile and has not been published to a registry:

```powershell
docker compose --profile app up -d --build
```

The image runs `prisma migrate deploy` and then `npm start`. It does not seed data. Building this image was not part of the verified local run unless the release notes say the image was built.

## SLA job

Call `POST /api/jobs/sla` with `Authorization: Bearer $CRON_SECRET` on a one-minute schedule after escalation is explicitly enabled. Until `sla.escalationEnabled` is true, the job returns without creating escalations.

## Rate limits

Login, public survey, and forgot-password limits are in-memory and apply to a single Node process. A multi-instance deployment needs a shared limiter before those limits can be treated as effective.
