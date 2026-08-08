# ServerHeat

ArtistHeat's REST API (Express + TypeScript + Prisma) over the PostgreSQL
database populated by the WordPress migration scripts (kept separately,
not part of this repo). Designed to be called by the
[ArtistHeat](https://github.com/gent1999/ArtistHeat) frontend (and, later,
any other client) over plain Bearer-token auth -- no session state lives
here.

## Setup

```bash
npm install
cp .env.example .env        # point DATABASE_URL at your local Postgres
npx prisma generate
npm run seed:admin          # creates/updates one admin_users row from SEED_ADMIN_*
npm run dev                 # http://localhost:4100
```

## Routes

Public (`GET`): `/api/articles`, `/api/articles/:slug`, `/api/categories`,
`/api/categories/:slug`, `/api/tags`, `/api/tags/:slug`, `/api/authors`,
`/api/authors/:slug`, `/api/redirects/lookup?path=`.

`GET /api/articles` also accepts an admin Bearer token + `?status=` to
list drafts (used by the admin dashboard); anonymous callers always only
see published articles.

Admin-only (Bearer token from `POST /api/auth/login`): create/update/delete
on articles, categories, tags, redirects.

## Schema changes

The database schema originates from a separate `schema.sql` (the
WordPress migration project's source of truth) and is mirrored here in
`prisma/schema.prisma` (kept in sync via `npx prisma db pull` after any
manual schema change, or `prisma migrate` if you move schema ownership
into Prisma going forward).
