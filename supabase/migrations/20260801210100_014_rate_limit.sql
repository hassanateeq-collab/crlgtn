-- ============================================================================
-- Corlington · migration 014 · Magic-link rate limiting (M8)
--
-- The vendor endpoint is the only unauthenticated surface. Tokens are 256-bit
-- and single-use, so brute force is not a realistic threat — but a scripted
-- scan should still hit a wall, and the wall should be cheap. Fixed-window
-- counter per caller key (IP), one upsert per request.
-- ============================================================================

create table app.rl_hits (
  key           text primary key,
  window_start  timestamptz not null,
  hits          integer not null
);

create or replace function public.check_rate_limit(
  p_key text,
  p_max integer,
  p_window_secs integer
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  insert into app.rl_hits as r (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update set
    hits = case
      when r.window_start < now() - make_interval(secs => p_window_secs) then 1
      else r.hits + 1
    end,
    window_start = case
      when r.window_start < now() - make_interval(secs => p_window_secs) then now()
      else r.window_start
    end
  returning hits <= p_max;
$$;

revoke execute on function public.check_rate_limit(text, integer, integer) from public;
revoke execute on function public.check_rate_limit(text, integer, integer) from anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

-- Stale keys are garbage after their window; sweep hourly.
select cron.schedule('corlington_rl_gc', '15 * * * *',
  $$delete from app.rl_hits where window_start < now() - interval '1 hour'$$);
