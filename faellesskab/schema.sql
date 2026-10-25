-- =====================================================================
--  GetTogether Fællesskab – Supabase database (v3: venner, grupper, opkald, kaldenavn-login, AI-tjek, moderatorer)
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

-- =====================================================================
--  v3: LOGIN MED KALDENAVN + KODE, AI-TJEK AF PROFILER, MODERATORER
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

-- ---------- Roller, AI-status og pause på profiler ----------
alter table public.profiles add column if not exists role text not null default 'member';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('member','moderator','admin'));
update public.profiles set role = 'admin' where is_admin and role = 'member';

alter table public.profiles add column if not exists ai_status text not null default 'ok';
alter table public.profiles drop constraint if exists profiles_ai_status_check;
alter table public.profiles add constraint profiles_ai_status_check check (ai_status in ('pending','ok','review','blocked'));
alter table public.profiles add column if not exists ai_reason text;
alter table public.profiles add column if not exists ai_checked_at timestamptz;
alter table public.profiles add column if not exists muted_until timestamptz;
alter table public.profiles add column if not exists muted_reason text;

-- ---------- Indstillinger (én række) ----------
create table if not exists public.app_settings (
  id               int primary key default 1 check (id = 1),
  ai_profile_check boolean not null default false,
  updated_at       timestamptz not null default now()
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- ---------- Opslag fra moderatorer (vises på alles forside) ----------
create table if not exists public.announcements (
  id         bigint generated always as identity primary key,
  author     uuid default auth.uid() references public.profiles(id) on delete set null,
  title      text not null check (char_length(title) between 2 and 80),
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists announcements_created_idx on public.announcements (created_at desc);

-- ---------- Log over alt, moderatorer og admin gør ----------
create table if not exists public.mod_log (
  id         bigint generated always as identity primary key,
  actor      uuid references public.profiles(id) on delete set null,
  action     text not null,
  target     uuid references public.profiles(id) on delete set null,
  detail     text,
  created_at timestamptz not null default now()
);
create index if not exists mod_log_created_idx on public.mod_log (created_at desc);

-- AI-tjekket opretter sager uden en menneskelig afsender
alter table public.reports alter column reporter drop not null;

-- ---------- Hjælpefunktioner ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' and not banned from profiles where id = auth.uid()), false)
$$;

create or replace function public.is_mod() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('moderator','admin') and not banned from profiles where id = auth.uid()), false)
$$;

-- Aktiv = må skrive: ikke udelukket, ikke på pause, og profilen er godkendt (eller til gennemsyn)
create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select not banned
                          and ai_status in ('ok','review')
                          and (muted_until is null or muted_until <= now())
                   from profiles where id = auth.uid()), false)
$$;

create or replace function public.ai_check_on() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select ai_profile_check from app_settings where id = 1), false)
$$;

-- Brugeren kan ikke selv ændre rolle, køn, kaldenavn (= login), udelukkelse, pause eller AI-status
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.is_admin := new.role = 'admin';
  if auth.uid() is null or coalesce(current_setting('gt.trusted', true), '') = 'on' then
    return new;  -- SQL Editor / service role (AI-tjekket) / moderator-funktionerne herunder
  end if;
  if tg_op = 'INSERT' then
    new.role := 'member'; new.is_admin := false;
    new.banned := false; new.banned_reason := null;
    new.muted_until := null; new.muted_reason := null;
    new.ai_status := case when public.ai_check_on() then 'pending' else 'ok' end;
    new.ai_reason := null; new.ai_checked_at := null;
    new.privacy_consent_at := coalesce(new.privacy_consent_at, now());
    return new;
  end if;
  if public.is_admin() and old.id <> auth.uid() then
    return new;  -- admin retter andres profil
  end if;
  new.role := old.role; new.is_admin := old.is_admin;
  new.gender := old.gender; new.nickname := old.nickname;
  new.banned := old.banned; new.banned_reason := old.banned_reason;
  new.muted_until := old.muted_until; new.muted_reason := old.muted_reason;
  new.privacy_consent_at := old.privacy_consent_at;
  new.ai_status := old.ai_status; new.ai_reason := old.ai_reason; new.ai_checked_at := old.ai_checked_at;
  -- ny tekst på profilen skal tjekkes igen (ikke for moderatorer og admin)
  if public.ai_check_on() and old.role = 'member'
     and (new.bio is distinct from old.bio or new.city is distinct from old.city or new.interests is distinct from old.interests) then
    new.ai_status := 'pending'; new.ai_reason := null;
  end if;
  return new;
end $$;

-- Rapporter: også fra AI-tjekket (uden afsender) og klager over en blokering
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
  if auth.uid() is not null
     and (select count(*) from reports where reporter = auth.uid() and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'For mange rapporter – prøv igen senere.';
  end if;
  return new;
end $$;

create or replace function public.log_mod(p_action text, p_target uuid, p_detail text) returns void
language sql security definer set search_path = public as $$
  insert into mod_log (actor, action, target, detail) values (auth.uid(), p_action, p_target, left(p_detail, 500))
$$;
revoke all on function public.log_mod(text, uuid, text) from public, anon, authenticated;

-- ---------- Moderator-handlinger ----------
create or replace function public.mod_review_profile(p_target uuid, p_approve boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t profiles;
begin
  if not public.is_mod() then raise exception 'Kun moderatorer.'; end if;
  select * into t from profiles where id = p_target;
  if t.id is null then raise exception 'Profilen findes ikke.'; end if;
  if t.role <> 'member' and not public.is_admin() then raise exception 'Du kan ikke ændre en anden moderator.'; end if;
  perform set_config('gt.trusted', 'on', true);
  update profiles set ai_status = case when p_approve then 'ok' else 'blocked' end,
                      ai_reason = case when p_approve then null else coalesce(nullif(trim(p_reason), ''), 'Stoppet af en moderator') end,
                      ai_checked_at = now()
   where id = p_target;
  perform set_config('gt.trusted', 'off', true);
  update reports set status = 'løst' where kind = 'profile' and target_id = p_target::text and status = 'ny';
  perform public.log_mod(case when p_approve then 'godkendte profil' else 'stoppede profil' end, p_target, p_reason);
end $$;

create or replace function public.mod_mute(p_target uuid, p_hours int, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t profiles;
begin
  if not public.is_mod() then raise exception 'Kun moderatorer.'; end if;
  if p_hours < 0 or p_hours > 168 then raise exception 'En pause kan højst vare 7 dage.'; end if;
  select * into t from profiles where id = p_target;
  if t.id is null then raise exception 'Profilen findes ikke.'; end if;
  if t.role <> 'member' and not public.is_admin() then raise exception 'Du kan ikke give en moderator pause.'; end if;
  perform set_config('gt.trusted', 'on', true);
  update profiles set muted_until = case when p_hours = 0 then null else now() + make_interval(hours => p_hours) end,
                      muted_reason = case when p_hours = 0 then null else nullif(trim(p_reason), '') end
   where id = p_target;
  perform set_config('gt.trusted', 'off', true);
  perform public.log_mod(case when p_hours = 0 then 'ophævede pause' else 'gav pause (' || p_hours || ' t)' end, p_target, p_reason);
end $$;

create or replace function public.mod_resolve_report(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_mod() then raise exception 'Kun moderatorer.'; end if;
  update reports set status = 'løst' where id = p_id;
  perform public.log_mod('lukkede sag', (select target_user from reports where id = p_id), null);
end $$;

create or replace function public.mod_delete_content(p_kind text, p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare who uuid; txt text;
begin
  if not public.is_mod() then raise exception 'Kun moderatorer.'; end if;
  if p_kind = 'message' then
    delete from messages where id = p_id returning user_id, body into who, txt;
  elsif p_kind = 'gmessage' then
    delete from group_messages where id = p_id returning user_id, body into who, txt;
  else
    raise exception 'Ukendt type.';
  end if;
  update reports set status = 'løst' where kind = p_kind and target_id = p_id::text and status = 'ny';
  perform public.log_mod('slettede besked', who, txt);
end $$;

-- ---------- Kun admin ----------
create or replace function public.admin_ban(p_target uuid, p_ban boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Kun admin.'; end if;
  if p_target = auth.uid() then raise exception 'Du kan ikke udelukke dig selv.'; end if;
  update profiles set banned = p_ban, banned_reason = case when p_ban then coalesce(nullif(trim(p_reason), ''), 'Brud på husreglerne') end
   where id = p_target;
  perform public.log_mod(case when p_ban then 'udelukkede' else 'ophævede udelukkelse' end, p_target, p_reason);
end $$;

create or replace function public.admin_set_role(p_target uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Kun admin.'; end if;
  if p_role not in ('member','moderator','admin') then raise exception 'Ukendt rolle.'; end if;
  if p_target = auth.uid() and p_role <> 'admin' then raise exception 'Du kan ikke fjerne din egen admin-adgang.'; end if;
  update profiles set role = p_role, ai_status = case when p_role <> 'member' then 'ok' else ai_status end where id = p_target;
  perform public.log_mod('satte rolle: ' || p_role, p_target, null);
end $$;

-- Ny login-kode til et medlem, der har mistet sin (vises kun for admin, én gang)
create or replace function public.admin_reset_code(p_target uuid)
returns text language plpgsql security definer set search_path = public, extensions, auth as $$
declare alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; code text := ''; i int;
begin
  if not public.is_admin() then raise exception 'Kun admin.'; end if;
  for i in 1..10 loop
    code := code || substr(alphabet, 1 + (get_byte(extensions.gen_random_bytes(1), 0) % 32), 1);
  end loop;
  update auth.users set encrypted_password = extensions.crypt(code, extensions.gen_salt('bf', 10)), updated_at = now()
   where id = p_target;
  if not found then raise exception 'Brugeren findes ikke.'; end if;
  perform public.log_mod('lavede ny login-kode', p_target, null);
  return substr(code, 1, 5) || '-' || substr(code, 6, 5);
end $$;

create or replace function public.admin_set_ai_check(p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Kun admin.'; end if;
  update app_settings set ai_profile_check = p_on, updated_at = now() where id = 1;
  perform public.log_mod(case when p_on then 'slog AI-tjek til' else 'slog AI-tjek fra' end, null, null);
end $$;

do $$ declare f text; begin
  foreach f in array array['mod_review_profile(uuid,boolean,text)','mod_mute(uuid,integer,text)','mod_resolve_report(bigint)',
    'mod_delete_content(text,bigint)','admin_ban(uuid,boolean,text)','admin_set_role(uuid,text)','admin_reset_code(uuid)','admin_set_ai_check(boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------- Sikkerhedsregler (opdateret) ----------
alter table public.app_settings  enable row level security;
alter table public.announcements enable row level security;
alter table public.mod_log       enable row level security;

drop policy if exists "profiles_read" on public.profiles;
create policy "profiles_read" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_mod() or (not banned and ai_status in ('ok','review')));

drop policy if exists "messages_delete" on public.messages;
create policy "messages_delete" on public.messages for delete to authenticated
  using (user_id = auth.uid() or public.is_mod());

drop policy if exists "gmsg_delete" on public.group_messages;
create policy "gmsg_delete" on public.group_messages for delete to authenticated
  using (user_id = auth.uid() or public.is_group_owner(group_id) or public.is_mod());

drop policy if exists "reports_admin_read" on public.reports;
drop policy if exists "reports_admin_update" on public.reports;
drop policy if exists "reports_mod_read" on public.reports;
create policy "reports_mod_read" on public.reports for select to authenticated
  using (public.is_mod());

-- Et medlem, hvis profil er stoppet, må stadig klage over det
drop policy if exists "reports_insert" on public.reports;
create policy "reports_insert" on public.reports for insert to authenticated
  with check (public.is_active() or (kind = 'profile' and target_id = auth.uid()::text));

drop policy if exists "settings_read" on public.app_settings;
create policy "settings_read" on public.app_settings for select to authenticated using (true);

drop policy if exists "ann_read" on public.announcements;
drop policy if exists "ann_post" on public.announcements;
drop policy if exists "ann_delete" on public.announcements;
create policy "ann_read" on public.announcements for select to authenticated using (true);
create policy "ann_post" on public.announcements for insert to authenticated
  with check (public.is_mod() and author = auth.uid());
create policy "ann_delete" on public.announcements for delete to authenticated
  using (author = auth.uid() or public.is_admin());

drop policy if exists "log_read" on public.mod_log;
create policy "log_read" on public.mod_log for select to authenticated using (public.is_mod());

do $$ begin alter publication supabase_realtime add table public.announcements; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.profiles;      exception when duplicate_object then null; end $$;

-- =====================================================================
--  v4: KUN MED FÆLLESSKABETS LINK
--  Man bliver medlem via fællesskabets link (…/faellesskab/?invite=NØGLE),
--  som medlemmerne sender videre til nye. Uden linket kan man ikke oprette
--  en profil. Den allerførste profil (din) kræver intet link.
--  Administratoren kan lave et nyt link (det gamle holder op med at virke)
--  og slå kravet fra i panelet.
-- =====================================================================
create or replace function public.new_join_key() returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea := gen_random_bytes(10); c text := ''; i int;
begin
  for i in 0..9 loop c := c || substr(alphabet, 1 + (get_byte(b, i) % 32), 1); end loop;
  return c;
end $$;
alter table public.app_settings add column if not exists invite_only boolean not null default true;
alter table public.app_settings add column if not exists join_key text;
update public.app_settings set join_key = public.new_join_key() where id = 1 and join_key is null;
alter table public.profiles add column if not exists invite_code text;   -- kun brugt under oprettelsen, gemmes aldrig
-- (rester fra en tidligere udgave med personlige invitationer)
drop function if exists public.create_invite();
drop function if exists public.revoke_invite(text);
drop table if exists public.invites;
alter table public.profiles drop column if exists invited_by;

-- Nøglen må kun ses af aktive medlemmer (via get_join_link) – ikke af alle, der er logget ind
revoke select on public.app_settings from anon, authenticated;
grant select (id, ai_profile_check, invite_only, updated_at) on public.app_settings to authenticated;

create or replace function public.clean_invite(p text) returns text
language sql immutable as $$ select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) $$;

-- Ny profil: kræver fællesskabets link (bortset fra den allerførste og SQL Editor)
create or replace function public.profiles_invite() returns trigger
language plpgsql security definer set search_path = public as $$
declare c text := public.clean_invite(new.invite_code); s record;
begin
  new.invite_code := null;
  if auth.uid() is null then return new; end if;
  select invite_only, join_key into s from app_settings where id = 1;
  if not coalesce(s.invite_only, true) then return new; end if;
  if not exists (select 1 from profiles) then return new; end if;
  if c = '' then
    raise exception 'Du skal bruge fællesskabets link for at blive medlem. Bed et medlem om det.';
  end if;
  if c <> public.clean_invite(s.join_key) then
    raise exception 'Linket virker ikke længere. Bed et medlem om det nyeste link.';
  end if;
  return new;
end $$;
drop trigger if exists profiles_invite_trg on public.profiles;
create trigger profiles_invite_trg before insert on public.profiles
for each row execute function public.profiles_invite();

-- Kan bruges uden login: virker linket?
create or replace function public.invite_info(p_code text) returns json
language plpgsql stable security definer set search_path = public as $$
declare c text := public.clean_invite(p_code); s record;
begin
  select invite_only, join_key into s from app_settings where id = 1;
  if not coalesce(s.invite_only, true) or not exists (select 1 from profiles) then
    return json_build_object('status', 'not_required');
  end if;
  if c = '' then return json_build_object('status', 'missing'); end if;
  if c <> public.clean_invite(s.join_key) then return json_build_object('status', 'invalid'); end if;
  return json_build_object('status', 'ok');
end $$;

-- Medlemmer henter linket for at sende det videre
create or replace function public.get_join_link() returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active() then raise exception 'Kun medlemmer kan dele linket.'; end if;
  return (select join_key from app_settings where id = 1);
end $$;

-- Admin: lav et nyt link (det gamle holder op med at virke)
create or replace function public.admin_new_join_link() returns text
language plpgsql security definer set search_path = public as $$
declare k text := public.new_join_key();
begin
  if not public.is_admin() then raise exception 'Kun admin.'; end if;
  update app_settings set join_key = k, updated_at = now() where id = 1;
  perform public.log_mod('lavede et nyt link til fællesskabet', null, null);
  return k;
end $$;

create or replace function public.admin_set_invite_only(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Kun admin.'; end if;
  update app_settings set invite_only = p_on, updated_at = now() where id = 1;
  perform public.log_mod(case when p_on then 'slog krav om link til' else 'slog krav om link fra' end, null, null);
end $$;

revoke all on function public.invite_info(text) from public;
grant execute on function public.invite_info(text) to anon, authenticated;
revoke all on function public.new_join_key() from public, anon, authenticated;
do $$ declare f text; begin
  foreach f in array array['get_join_link()','admin_new_join_link()','admin_set_invite_only(boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- =====================================================================
--  v5: TÆLLEREN I GUIDEN ("du er nr. X") – virker også uden Netlify-funktioner
--  Hjemmesiden sender /api/count videre til Supabase-funktionen "count".
--  Gemmer kun ét tal. Ingen IP-adresser eller personlige data.
-- =====================================================================
create table if not exists public.nur_counter (
  id int primary key default 1 check (id = 1),
  n  bigint not null default 0
);
insert into public.nur_counter (id) values (1) on conflict (id) do nothing;
alter table public.nur_counter enable row level security;
revoke all on public.nur_counter from anon, authenticated;

create or replace function public.nur_count(p_bump boolean) returns bigint
language sql volatile security definer set search_path = public as $$
  update public.nur_counter set n = n + (case when p_bump then 1 else 0 end) where id = 1 returning n;
$$;
revoke all on function public.nur_count(boolean) from public, anon, authenticated;
grant execute on function public.nur_count(boolean) to service_role;

-- ---------- Gør dig selv til admin (kør EFTER du har oprettet din profil i appen) ----------
-- Skriv dit kaldenavn i stedet for DIT-KALDENAVN:
-- update public.profiles set role = 'admin' where lower(nickname) = lower('DIT-KALDENAVN');
