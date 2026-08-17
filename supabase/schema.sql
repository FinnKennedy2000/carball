-- Car Soccer accounts and stats.
-- Apply with:  supabase db push        (or paste into the SQL editor)
--
-- Two tables only. Career totals are a view over the per-match rows rather than
-- counters, so concurrent match reports cannot race each other and the history
-- is never lost.

-- Profiles ------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text not null unique
    check (char_length(username) between 2 and 16),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Names are public: they appear in the roster and on the leaderboard.
drop policy if exists "profiles are readable by everyone" on public.profiles;
create policy "profiles are readable by everyone"
  on public.profiles for select using (true);

drop policy if exists "a player may edit only their own profile" on public.profiles;
-- auth.uid() is wrapped in a select so the planner evaluates it once for the
-- statement rather than once per row.
create policy "a player may edit only their own profile"
  on public.profiles for update
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- The row is created by the trigger below, not by the client.
drop policy if exists "a player may create only their own profile" on public.profiles;
create policy "a player may create only their own profile"
  on public.profiles for insert with check ((select auth.uid()) = id);

-- Sign-up carries the wanted username in user metadata. A collision must not
-- fail the sign-up, so the name is suffixed until it is free.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
-- An empty search_path with fully-qualified names: a security definer function
-- must not be resolvable against a caller-controlled path.
set search_path = ''
as $$
declare
  wanted text := nullif(trim(new.raw_user_meta_data ->> 'username'), '');
  candidate text;
begin
  candidate := left(coalesce(wanted, split_part(new.email, '@', 1), 'player'), 16);
  if char_length(candidate) < 2 then
    candidate := 'player';
  end if;

  -- At most a handful of attempts; the suffix is random, not a sequence scan.
  for i in 1..20 loop
    begin
      insert into public.profiles (id, username) values (new.id, candidate);
      return new;
    exception when unique_violation then
      candidate := left(candidate, 11) || '-' || substr(md5(random()::text), 1, 4);
    end;
  end loop;

  insert into public.profiles (id, username) values (new.id, 'player-' || substr(new.id::text, 1, 8));
  return new;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function, so a security definer
-- function in an exposed schema is a public endpoint until this is revoked. It is
-- only ever meant to run as the trigger below.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Match results -------------------------------------------------------------

create table if not exists public.match_players (
  match_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  team smallint not null check (team in (0, 1)),
  goals integer not null default 0 check (goals >= 0),
  won boolean not null,
  drawn boolean not null default false,
  played_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

create index if not exists match_players_user_idx on public.match_players (user_id);

alter table public.match_players enable row level security;

-- Readable by anyone; only the server (service role, which bypasses RLS) writes.
drop policy if exists "match results are readable by everyone" on public.match_players;
create policy "match results are readable by everyone"
  on public.match_players for select using (true);

-- Leaderboard ---------------------------------------------------------------

create or replace view public.leaderboard
with (security_invoker = true) as
select
  p.id,
  p.username,
  count(*)::int as matches,
  coalesce(sum(m.goals), 0)::int as goals,
  count(*) filter (where m.won)::int as wins,
  count(*) filter (where m.drawn)::int as draws,
  count(*) filter (where not m.won and not m.drawn)::int as losses
from public.profiles p
join public.match_players m on m.user_id = p.id
group by p.id, p.username;

-- Privileges -----------------------------------------------------------------
-- RLS decides which rows are visible. Privileges decide whether the table is
-- reachable at all — a separate question, and one RLS does not answer: TRUNCATE
-- is not subject to RLS in the first place.
--
-- Supabase's default privileges grant ALL on new tables in `public` to anon and
-- authenticated, so granting what we want is not enough; the defaults have to be
-- revoked first, or the clients silently keep DELETE and TRUNCATE.

revoke all on public.profiles from anon, authenticated;
revoke all on public.match_players from anon, authenticated;
revoke all on public.leaderboard from anon, authenticated;

grant usage on schema public to anon, authenticated;

-- Names are public, and a signed-in player may rename only themselves. The row
-- itself is created by the on_auth_user_created trigger, not by the client.
grant select on public.profiles to anon, authenticated;
grant insert on public.profiles to authenticated;
grant update (username) on public.profiles to authenticated;

-- Results and the leaderboard are read-only to every client: only the server,
-- holding the service role key, writes them.
grant select on public.match_players to anon, authenticated;
grant select on public.leaderboard to anon, authenticated;
