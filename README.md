# Backend — D' Educationist Accounting API

NestJS + Prisma + PostgreSQL. Milestone status: **M1–M14 Done**; **M15** = handover pack + UAT readiness (client sign-off pending).

## Default local port

API defaults to **`PORT=3001`**. Frontend: `VITE_API_URL=http://localhost:3001/api/v1`.

## Setup

```bash
cd backend
cp .env.example .env
# Edit DATABASE_URL + JWT secrets

# Enable citext once
psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS citext;"

npm install
npx prisma generate
npx prisma migrate deploy
npm run prisma:seed
npm run start:dev
```

Production: `npm run build` then `npm run start:prod` (auto-runs `prisma migrate deploy` — skips migrations already applied). See [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md).

## Seed users

Password from `SEED_PASSWORD` (default **`ChangeMe123!`**):

| Email | Role |
|-------|------|
| admin@saa.com | Super Admin |
| ahmed@saa.com | Branch Manager |
| sara@saa.com | Accountant |
| bilal@saa.com | Cashier |
| fatima@saa.com | Counsellor |
| … | see `prisma/seed.ts` |

**Change passwords before production.**

## Verify

```bash
node scripts/verify-m14.js
node scripts/verify-m15.js
```

## Docs

- [../docs/BACKEND-MILESTONES.md](../docs/BACKEND-MILESTONES.md)
- [../docs/HANDOVER.md](../docs/HANDOVER.md)
- [../README.md](../README.md)
