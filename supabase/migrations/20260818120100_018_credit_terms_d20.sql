-- Corlington · migration 018 · credit_terms gains d20 (owner cash-flow rule 2026-08-18).
-- Standalone because a new enum value cannot be referenced in the same transaction.
alter type public.credit_terms add value if not exists 'd20';
