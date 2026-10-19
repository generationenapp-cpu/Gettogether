-- =====================================================================
--  GetTogether Fællesskab – Supabase database (produktion v2: venner, grupper, opkald)
--  Kør HELE filen i Supabase → SQL Editor → "Run".
--  Filen kan køres igen uden at slette data (fx efter opdateringer).
-- =====================================================================

-- ---------- Tabeller ----------
create table if not exists public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  nickname            text not null check (char_length(nickname) between 2 and 30),
  city                text check (char_length(city) <= 40),
  gender              text not null check (gender in ('kvinde','mand')),
  journey             text not null check (journey in ('ny','født','undersøger')),
  bio                 text check (char_length(bio) <= 300),
  interests           text[] not null default '{}',
  dm_pref             text not null default 'samme_koen' check (dm_pref in ('alle','samme_koen','ingen')),
  adult_confirmed     boolean not null check (adult_confirmed),
  rules_accepted      boolean not null check (rules_accepted),
  is_admin            boolean not null default false,
  created_at          timestamptz not null default now()
);
alter table public.profiles add column if not exists privacy_consent_at timestamptz;
alter table public.profiles add column if not exists banned boolean not null default false;
alter table public.profiles add column if not exists banned_reason text;
create unique index if not exists profiles_nickname_unique on public.profiles (lower(nickname));

create table if not exists public.rooms (
  id          text primary key,
  name        text not null,
  description text,
  emoji       text,
  gender_only text check (gender_only in ('kvinde','mand')),
  sort        int not null default 0
);

create table if not exists public.messages (
  id         bigint generated always as identity primary key,
  room_id    text not null references public.rooms(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists messages_room_idx on public.messages (room_id, created_at desc);
create index if not exists messages_user_idx on public.messages (user_id);

create table if not exists public.direct_messages (
  id         bigint generated always as identity primary key,
  sender     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  recipient  uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  check (sender <> recipient)
);
create index if not exists dm_pair_idx on public.direct_messages (sender, recipient, created_at desc);
create index if not exists dm_recipient_idx on public.direct_messages (recipient, created_at desc);

create table if not exists public.blocks (
  blocker    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  blocked    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked)
);

create table if not exists public.reports (
  id         bigint generated always as identity primary key,
  reporter   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('message','dm','profile')),
  target_id  text not null,
  reason     text check (char_length(reason) <= 500),
  status     text not null default 'ny',
  created_at timestamptz not null default now()
);
alter table public.reports add column if not exists target_user uuid references public.profiles(id) on delete set null;
alter table public.reports add column if not exists snapshot text;
create index if not exists reports_status_idx on public.reports (status, created_at desc);

-- ---------- Hjælpefunktioner ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin and not banned from profiles where id = auth.uid()), false)
$$;

create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select not banned from profiles where id = auth.uid()), false)
$$;

create or replace function public.my_gender() returns text
language sql stable security definer set search_path = public as $$
  select gender from profiles where id = auth.uid()
$$;

create or replace function public.can_dm(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles r, profiles s
    where r.id = target and s.id = auth.uid() and not r.banned and not s.banned
      and (r.dm_pref = 'alle' or (r.dm_pref = 'samme_koen' and r.gender = s.gender))
  )
  and not exists (
    select 1 from blocks b
    where (b.blocker = target and b.blocked = auth.uid())
       or (b.blocker = auth.uid() and b.blocked = target)
  )
$$;

-- Brugeren kan ikke selv ændre køn, admin- eller udelukkelses-status
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;  -- SQL Editor / service role / admin
  end if;
  if tg_op = 'INSERT' then
    new.is_admin := false;
    new.banned := false;
    new.banned_reason := null;
    new.privacy_consent_at := coalesce(new.privacy_consent_at, now());
  else
    new.is_admin := old.is_admin;
    new.gender := old.gender;
    new.banned := old.banned;
    new.banned_reason := old.banned_reason;
    new.privacy_consent_at := old.privacy_consent_at;
  end if;
  return new;
end $$;
drop trigger if exists protect_profile_trg on public.profiles;
create trigger protect_profile_trg before insert or update on public.profiles
for each row execute function public.protect_profile();

-- Spam-bremse: max 15 beskeder pr. minut
create or replace function public.rate_limit_messages() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from messages
      where user_id = new.user_id and created_at > now() - interval '1 minute') >= 15 then
    raise exception 'Du skriver for hurtigt – vent et øjeblik.';
  end if;
  return new;
end $$;
create or replace function public.rate_limit_dms() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from direct_messages
      where sender = new.sender and created_at > now() - interval '1 minute') >= 15 then
    raise exception 'Du skriver for hurtigt – vent et øjeblik.';
  end if;
  return new;
end $$;
drop trigger if exists rl_messages on public.messages;
create trigger rl_messages before insert on public.messages
for each row execute function public.rate_limit_messages();
drop trigger if exists rl_dms on public.direct_messages;
create trigger rl_dms before insert on public.direct_messages
for each row execute function public.rate_limit_dms();

-- Rapporter: gem en kopi af indholdet som bevis (også hvis det senere slettes)
create or replace function public.report_snapshot() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.reporter := auth.uid();
  new.status := 'ny';
  if new.kind = 'message' then
    select body, user_id into new.snapshot, new.target_user
      from messages where id = new.target_id::bigint;
  elsif new.kind = 'dm' then
    select body, sender into new.snapshot, new.target_user
      from direct_messages where id = new.target_id::bigint and auth.uid() in (sender, recipient);
  elsif new.kind = 'profile' then
    new.target_user := new.target_id::uuid;
    select nickname || ' – ' || coalesce(bio, '') into new.snapshot
      from profiles where id = new.target_id::uuid;
  end if;
  if (select count(*) from reports where reporter = auth.uid() and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'For mange rapporter – prøv igen senere.';
  end if;
  return new;
end $$;
drop trigger if exists report_snapshot_trg on public.reports;
create trigger report_snapshot_trg before insert on public.reports
for each row execute function public.report_snapshot();

-- Slet hele min konto (login + profil + alle beskeder)
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'Ikke logget ind'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------- Row Level Security ----------
alter table public.profiles        enable row level security;
alter table public.rooms           enable row level security;
alter table public.messages        enable row level security;
alter table public.direct_messages enable row level security;
alter table public.blocks          enable row level security;
alter table public.reports         enable row level security;

-- Ryd gamle regler så filen kan køres igen
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public'
             and tablename in ('profiles','rooms','messages','direct_messages','blocks','reports') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- profiles
create policy "profiles_read" on public.profiles for select to authenticated
  using (not banned or id = auth.uid() or public.is_admin());
create policy "profiles_insert" on public.profiles for insert to authenticated
  with check (id = auth.uid());
create policy "profiles_update" on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy "profiles_delete" on public.profiles for delete to authenticated
  using (id = auth.uid() or public.is_admin());

-- rooms
create policy "rooms_read" on public.rooms for select to authenticated
  using (gender_only is null or gender_only = public.my_gender() or public.is_admin());
create policy "rooms_admin" on public.rooms for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- messages
create policy "messages_read" on public.messages for select to authenticated
  using (public.is_active() and exists (select 1 from public.rooms r where r.id = room_id
         and (r.gender_only is null or r.gender_only = public.my_gender() or public.is_admin())));
create policy "messages_insert" on public.messages for insert to authenticated
  with check (user_id = auth.uid() and public.is_active() and exists (
    select 1 from public.rooms r where r.id = room_id
    and (r.gender_only is null or r.gender_only = public.my_gender())));
create policy "messages_delete" on public.messages for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- direct messages
create policy "dm_read" on public.direct_messages for select to authenticated
  using (auth.uid() in (sender, recipient));
create policy "dm_insert" on public.direct_messages for insert to authenticated
  with check (sender = auth.uid() and public.can_dm(recipient));
create policy "dm_delete" on public.direct_messages for delete to authenticated
  using (sender = auth.uid() or public.is_admin());

-- blocks
create policy "blocks_own" on public.blocks for all to authenticated
  using (blocker = auth.uid()) with check (blocker = auth.uid());

-- reports
create policy "reports_insert" on public.reports for insert to authenticated
  with check (public.is_active());
create policy "reports_admin_read" on public.reports for select to authenticated
  using (public.is_admin());
create policy "reports_admin_update" on public.reports for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- Realtime ----------
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.direct_messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.reports;
exception when duplicate_object then null; end $$;

-- ---------- Rum ----------
insert into public.rooms (id, name, description, emoji, gender_only, sort) values
  ('velkommen',   'Sig hej',              'Ny her? Fortæl hvem du er, og hvor du kommer fra.',      '👋', null,     1),
  ('nye-muslimer','Ny i troen',           'Til dig, der er ny muslim. Del din vej – også tvivlen.', '🌱', null,     2),
  ('spoergsmaal', 'Spørg løs',            'Bøn, faste, Koranen og hverdagen. Alle spørgsmål er velkomne.', '❓', null, 3),
  ('hverdag',     'Muslim i Danmark',     'Arbejde, studie, familie og at finde sin plads.',        '🇩🇰', null,     4),
  ('hoejtider',   'Ramadan og højtider',  'Iftar-planer, Eid og alt det imellem.',                  '🌙', null,     5),
  ('moedes',      'Mødes i virkeligheden','Moskébesøg, gåture og studiekredse rundt i landet.',     '☕', null,     6),
  ('soestre',     'Søstre',               'Et roligt rum kun for kvinder.',                         '🌸', 'kvinde', 7),
  ('broedre',     'Brødre',               'Et rum kun for mænd.',                                   '🤝', 'mand',   8)
on conflict (id) do update set name = excluded.name, description = excluded.description, emoji = excluded.emoji;

-- =====================================================================
--  VENNER, PRIVATE GRUPPER OG OPKALD
-- =====================================================================

-- ---------- Venskaber ----------
create table if not exists public.friendships (
  id         uuid primary key default gen_random_uuid(),
  requester  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  addressee  uuid not null references public.profiles(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  check (requester <> addressee)
);
create unique index if not exists friendships_pair_unique
  on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index if not exists friendships_addressee_idx on public.friendships (addressee, status);

create or replace function public.are_friends(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from friendships
    where status = 'accepted'
      and ((requester = auth.uid() and addressee = other) or (requester = other and addressee = auth.uid())))
$$;

create or replace function public.is_blocked_pair(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks
    where (blocker = auth.uid() and blocked = other) or (blocker = other and blocked = auth.uid()))
$$;

-- Venner må altid skrive privat til hinanden (ud over dm-indstillingen)
create or replace function public.can_dm(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles r, profiles s
    where r.id = target and s.id = auth.uid() and not r.banned and not s.banned
      and (public.are_friends(target)
           or r.dm_pref = 'alle'
           or (r.dm_pref = 'samme_koen' and r.gender = s.gender))
  ) and not public.is_blocked_pair(target)
$$;

-- Venneanmodninger: kun 'pending' ved oprettelse, max 30 pr. døgn
create or replace function public.friendship_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.requester := auth.uid();
    new.status := 'pending';
    new.accepted_at := null;
    if (select count(*) from friendships where requester = auth.uid() and created_at > now() - interval '1 day') >= 30 then
      raise exception 'Du har sendt mange venneanmodninger i dag – prøv igen i morgen.';
    end if;
  elsif tg_op = 'UPDATE' then
    if auth.uid() is not null and auth.uid() <> old.addressee then
      raise exception 'Kun modtageren kan acceptere en venneanmodning.';
    end if;
    new.requester := old.requester; new.addressee := old.addressee;
    if new.status = 'accepted' and old.status = 'pending' then new.accepted_at := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists friendship_guard_trg on public.friendships;
create trigger friendship_guard_trg before insert or update on public.friendships
for each row execute function public.friendship_guard();

-- Blokering fjerner også venskabet
create or replace function public.block_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from friendships
   where (requester = new.blocker and addressee = new.blocked)
      or (requester = new.blocked and addressee = new.blocker);
  return new;
end $$;
drop trigger if exists block_cleanup_trg on public.blocks;
create trigger block_cleanup_trg after insert on public.blocks
for each row execute function public.block_cleanup();

-- ---------- Private grupper ----------
create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 2 and 40),
  emoji      text not null default '💬' check (char_length(emoji) <= 8),
  owner      uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id  uuid not null references public.groups(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      text not null default 'member' check (role in ('owner','member')),
  added_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user_idx on public.group_members (user_id);

create table if not exists public.group_messages (
  id         bigint generated always as identity primary key,
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists group_messages_idx on public.group_messages (group_id, created_at desc);

create or replace function public.is_member(gid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members where group_id = gid and user_id = auth.uid())
$$;
create or replace function public.is_group_owner(gid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from groups where id = gid and owner = auth.uid())
$$;

-- Ejeren bliver automatisk medlem; max 20 grupper pr. bruger
create or replace function public.group_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into group_members (group_id, user_id, role, added_by) values (new.id, new.owner, 'owner', new.owner);
  return new;
end $$;
create or replace function public.group_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.owner := auth.uid();
  if (select count(*) from groups where owner = auth.uid()) >= 20 then
    raise exception 'Du kan højst eje 20 grupper.';
  end if;
  return new;
end $$;
drop trigger if exists group_before_insert_trg on public.groups;
create trigger group_before_insert_trg before insert on public.groups
for each row execute function public.group_before_insert();
drop trigger if exists group_after_insert_trg on public.groups;
create trigger group_after_insert_trg after insert on public.groups
for each row execute function public.group_after_insert();

-- Kun ejeren tilføjer – og kun egne venner. Max 50 medlemmer.
create or replace function public.member_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.role = 'owner' and not exists (select 1 from groups where id = new.group_id and owner = new.user_id) then
    new.role := 'member';
  end if;
  if new.user_id <> auth.uid() and not public.are_friends(new.user_id) then
    raise exception 'Du kan kun tilføje dine venner til en gruppe.';
  end if;
  if (select count(*) from group_members where group_id = new.group_id) >= 50 then
    raise exception 'En gruppe kan højst have 50 medlemmer.';
  end if;
  new.added_by := auth.uid();
  return new;
end $$;
drop trigger if exists member_guard_trg on public.group_members;
create trigger member_guard_trg before insert on public.group_members
for each row execute function public.member_guard();

create or replace function public.rate_limit_group_messages() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from group_messages
      where user_id = new.user_id and created_at > now() - interval '1 minute') >= 15 then
    raise exception 'Du skriver for hurtigt – vent et øjeblik.';
  end if;
  return new;
end $$;
drop trigger if exists rl_group_messages on public.group_messages;
create trigger rl_group_messages before insert on public.group_messages
for each row execute function public.rate_limit_group_messages();

-- ---------- Opkald ----------
create table if not exists public.calls (
  id         uuid primary key default gen_random_uuid(),
  caller     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  callee     uuid not null references public.profiles(id) on delete cascade,
  status     text not null default 'ringing' check (status in ('ringing','accepted','declined','missed','ended')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at   timestamptz,
  check (caller <> callee)
);
create index if not exists calls_callee_idx on public.calls (callee, created_at desc);
create index if not exists calls_caller_idx on public.calls (caller, created_at desc);

create or replace function public.call_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.caller := auth.uid(); new.status := 'ringing'; new.answered_at := null; new.ended_at := null;
    if not public.are_friends(new.callee) or public.is_blocked_pair(new.callee) or not public.is_active() then
      raise exception 'Du kan kun ringe til dine venner.';
    end if;
    if (select count(*) from calls where caller = auth.uid() and created_at > now() - interval '10 minutes') >= 20 then
      raise exception 'Du har ringet mange gange på kort tid – vent lidt.';
    end if;
    -- gamle ubesvarede opkald lukkes
    update calls set status = 'missed', ended_at = now()
     where status = 'ringing' and created_at < now() - interval '2 minutes';
  else
    new.caller := old.caller; new.callee := old.callee; new.created_at := old.created_at;
    if new.status = 'accepted' and old.status = 'ringing' then
      if auth.uid() <> old.callee then raise exception 'Kun modtageren kan tage telefonen.'; end if;
      new.answered_at := now();
    end if;
    if new.status in ('declined','missed','ended') and old.ended_at is null then new.ended_at := now(); end if;
    if old.status in ('declined','missed','ended') then new.status := old.status; end if;
  end if;
  return new;
end $$;
drop trigger if exists call_guard_trg on public.calls;
create trigger call_guard_trg before insert or update on public.calls
for each row execute function public.call_guard();

-- ---------- Rapporter: også gruppebeskeder ----------
alter table public.reports drop constraint if exists reports_kind_check;
alter table public.reports add constraint reports_kind_check check (kind in ('message','dm','profile','gmessage'));
create or replace function public.report_snapshot() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.reporter := auth.uid();
  new.status := 'ny';
  if new.kind = 'message' then
    select body, user_id into new.snapshot, new.target_user from messages where id = new.target_id::bigint;
  elsif new.kind = 'dm' then
    select body, sender into new.snapshot, new.target_user
      from direct_messages where id = new.target_id::bigint and auth.uid() in (sender, recipient);
  elsif new.kind = 'gmessage' then
    select body, user_id into new.snapshot, new.target_user
      from group_messages where id = new.target_id::bigint and public.is_member(group_id);
  elsif new.kind = 'profile' then
    new.target_user := new.target_id::uuid;
    select nickname || ' – ' || coalesce(bio, '') into new.snapshot from profiles where id = new.target_id::uuid;
  end if;
  if (select count(*) from reports where reporter = auth.uid() and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'For mange rapporter – prøv igen senere.';
  end if;
  return new;
end $$;

-- ---------- Sikkerhedsregler for de nye tabeller ----------
alter table public.friendships    enable row level security;
alter table public.groups         enable row level security;
alter table public.group_members  enable row level security;
alter table public.group_messages enable row level security;
alter table public.calls          enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public'
             and tablename in ('friendships','groups','group_members','group_messages','calls') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "friends_read" on public.friendships for select to authenticated
  using (auth.uid() in (requester, addressee));
create policy "friends_request" on public.friendships for insert to authenticated
  with check (public.is_active() and not public.is_blocked_pair(addressee));
create policy "friends_accept" on public.friendships for update to authenticated
  using (addressee = auth.uid()) with check (addressee = auth.uid());
create policy "friends_remove" on public.friendships for delete to authenticated
  using (auth.uid() in (requester, addressee));

create policy "groups_read" on public.groups for select to authenticated
  using (owner = auth.uid() or public.is_member(id) or public.is_admin());
create policy "groups_create" on public.groups for insert to authenticated
  with check (public.is_active());
create policy "groups_edit" on public.groups for update to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
create policy "groups_delete" on public.groups for delete to authenticated
  using (owner = auth.uid() or public.is_admin());

create policy "members_read" on public.group_members for select to authenticated
  using (public.is_member(group_id));
create policy "members_add" on public.group_members for insert to authenticated
  with check (public.is_group_owner(group_id) and public.is_active());
create policy "members_remove" on public.group_members for delete to authenticated
  using ((user_id = auth.uid() and role <> 'owner') or (public.is_group_owner(group_id) and role <> 'owner'));

create policy "gmsg_read" on public.group_messages for select to authenticated
  using (public.is_member(group_id));
create policy "gmsg_send" on public.group_messages for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(group_id) and public.is_active());
create policy "gmsg_delete" on public.group_messages for delete to authenticated
  using (user_id = auth.uid() or public.is_group_owner(group_id) or public.is_admin());

create policy "calls_read" on public.calls for select to authenticated
  using (auth.uid() in (caller, callee));
create policy "calls_start" on public.calls for insert to authenticated
  with check (true);  -- call_guard tjekker venskab
create policy "calls_update" on public.calls for update to authenticated
  using (auth.uid() in (caller, callee)) with check (auth.uid() in (caller, callee));

-- ---------- Opkaldssignaler: kun de to parter kan tilgå kanalen "call:<id>" ----------
create or replace function public.can_use_call_topic(topic text) returns boolean
language sql stable security definer set search_path = public as $$
  select topic like 'call:%' and exists (
    select 1 from calls
    where id::text = substring(topic from 6)
      and auth.uid() in (caller, callee)
      and status in ('ringing','accepted'))
$$;
drop policy if exists "call_signal_read" on realtime.messages;
drop policy if exists "call_signal_send" on realtime.messages;
create policy "call_signal_read" on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'broadcast' and public.can_use_call_topic(realtime.topic()));
create policy "call_signal_send" on realtime.messages for insert to authenticated
  with check (realtime.messages.extension = 'broadcast' and public.can_use_call_topic(realtime.topic()));

-- ---------- Realtime for de nye tabeller ----------
do $$ begin alter publication supabase_realtime add table public.friendships;    exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.group_members;  exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.group_messages; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.groups;         exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.calls;          exception when duplicate_object then null; end $$;

-- ---------- Gør dig selv til admin (kør EFTER du har oprettet din profil i appen) ----------
-- update public.profiles set is_admin = true
-- where id = (select id from auth.users where email = 'DIN@EMAIL.dk');
