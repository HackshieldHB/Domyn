# DOMYN

Integrated restroom satisfaction and service management for TLT/TSO operations. Public tablets collect anonymous ratings. Internal users handle staff coverage, complaints, SLA visibility, and reporting.

Proposed business rules that TLT has not approved are stored as settings or decisions and labeled provisional. They are not treated as approved policy.

## Local setup

Requirements: Node.js 22, Docker Desktop (for PostgreSQL).

```powershell
copy .env.example .env
docker compose up -d postgres
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Open http://localhost:3000.

The seed script stops if `admin@domyn.local` already exists. `npm run db:reset` drops the database, reapplies migrations, and seeds again. Seed refuses to run when `NODE_ENV=production` unless `SEED_ALLOW_PRODUCTION=true`.

## Development accounts

Password comes from `SEED_DEMO_PASSWORD` (default `ChangeMe-Dev-Only!`). These accounts exist only after seeding and must not be used in production.

| Email | Role |
|---|---|
| admin@domyn.local | Admin |
| supervisor@domyn.local | Supervisor |
| staff@domyn.local | Staff |
| management@domyn.local | Management |

Kiosk exit PIN in the seeded database: `2468`. Public survey URLs use the device code, for example http://localhost:3000/kiosk/TAB-TLT-GF-STARBUCKS.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm test` | Vitest, including database integrity tests. Requires `.env` and a migrated database. |
| `npm run db:migrate` | Create a new Prisma migration |
| `npm run db:deploy` | Apply migrations |
| `npm run db:seed` | Load development data |
| `npm run job:sla` | Run the overdue/escalation sweep once |

## Environment

See `.env.example`. Do not commit `.env`.

`WHATSAPP_PROVIDER=sandbox` records notification attempts and does not contact WhatsApp. A real send happens only when the provider is `whatsapp` and `WHATSAPP_API_URL`, `WHATSAPP_TOKEN`, `WHATSAPP_SENDER`, and `WHATSAPP_TEMPLATE_NAME` are all set. Missing credentials fail the attempt; the complaint record is kept.

Password reset email is not configured. In development, the forgot-password response can include a reset path when `EXPOSE_RESET_TOKEN=true`. Production does not create a self-service token.

## Documentation

- [Architecture and data model](docs/architecture.md)
- [API](docs/api.md)
- [Deployment](docs/deployment.md)
- [Operations](docs/runbook.md)
- [Pending TLT decisions](docs/pending-decisions.md)
