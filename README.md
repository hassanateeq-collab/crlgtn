# Corlington

Closed-access B2B corporate booking platform. Karachi-first, hotels at launch,
multi-vertical by design.

## Layout

```
web/                    React portal (Vite + TS + Tailwind) — corporate, ops, vendor surfaces
supabase/
  migrations/           Numbered, append-only. Never edit production schema by hand.
  functions/
    _shared/            The Edge Function envelope: JWT → validate → write → audit → respond
    ef_whoami/          Template function + diagnostics endpoint
  seed.sql              Fictional dev data (corridors, corporates, hotels)
BUILD_LOG.md            Session-by-session memory: what was built, decisions, lessons
```

## The two standing rules

1. **Every write goes through an Edge Function.** Clients hold the publishable
   key only. Migration 004 revokes write privileges from `authenticated`/`anon`
   at the database level, so this is enforced, not conventional.
2. **RLS on every table before it holds data.** Corporate rows scope by
   `corporate_id`, vendor rows by `vendor_id`, ops via JWT role claim
   (`app_metadata.role`, service-role writable only).

Money is integer PKR. Timestamps are stored UTC, rendered Asia/Karachi.

## Development

```bash
cd web && cp .env.example .env && npm install && npm run dev
```

Backend changes are applied to the hosted Supabase project via MCP/CLI
migrations — see `BUILD_LOG.md` for the current migration head and the
done-gate status of each milestone.
