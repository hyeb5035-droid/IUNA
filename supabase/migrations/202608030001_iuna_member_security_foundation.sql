-- IUNA 2.0 / DB implementation v1
-- Scope: members, private profiles, membership status/grade, operator roles,
--        audit foundation, applicant private-profile access RPC
-- Target: Supabase PostgreSQL
-- Created: 2026-08-03

begin;

create extension if not exists pgcrypto;

-- =========================================================
-- 1. ENUMS
-- =========================================================

do $$ begin
  create type public.member_grade as enum ('associate', 'regular', 'honorary');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.member_status as enum ('active', 'dormant', 'withdrawn', 'expelled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.gender_type as enum ('female', 'male', 'undisclosed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.retention_status as enum ('active', 'pending_destruction', 'destroyed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.history_reason_code as enum (
    'signup',
    'promotion',
    'manual_change',
    'half_year_inactivity',
    'reactivation',
    'withdrawal',
    'expulsion',
    'data_migration'
  );
exception when duplicate_object then null;
end $$;

-- =========================================================
-- 2. COMMON FUNCTIONS
-- =========================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create sequence if not exists public.member_number_seq start 1;

create or replace function public.generate_member_no()
returns text
language sql
security definer
set search_path = ''
as $$
  select 'IUNA-' || to_char(current_date, 'YYYY') || '-' ||
         lpad(nextval('public.member_number_seq')::text, 5, '0');
$$;

revoke all on function public.generate_member_no() from public, anon, authenticated;

-- =========================================================
-- 3. MEMBER TABLES
-- =========================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  member_no text not null unique default public.generate_member_no(),
  nickname text,
  profile_image_path text,
  company_name text,
  job_title text,
  introduction text,
  interests text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint profiles_nickname_length
    check (nickname is null or char_length(nickname) between 1 and 40),
  constraint profiles_introduction_length
    check (introduction is null or char_length(introduction) <= 1000)
);

create table if not exists public.profile_private (
  user_id uuid primary key references public.profiles(id) on delete restrict,
  legal_name text,
  gender public.gender_type,
  birth_date date,
  phone text,
  retention_status public.retention_status not null default 'active',
  retention_until date,
  destroyed_at timestamptz,
  destruction_method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint private_name_length
    check (legal_name is null or char_length(legal_name) between 1 and 80),
  constraint private_phone_length
    check (phone is null or char_length(phone) between 8 and 30),
  constraint private_birth_date_valid
    check (birth_date is null or birth_date <= current_date),
  constraint private_retention_consistency check (
    (retention_status = 'active' and destroyed_at is null)
    or
    (retention_status = 'pending_destruction' and retention_until is not null and destroyed_at is null)
    or
    (retention_status = 'destroyed' and destroyed_at is not null)
  )
);

create table if not exists public.memberships (
  user_id uuid primary key references public.profiles(id) on delete restrict,
  grade public.member_grade not null default 'associate',
  status public.member_status not null default 'active',
  grade_started_at timestamptz not null default now(),
  status_started_at timestamptz not null default now(),
  last_completed_activity_at timestamptz,
  dormant_at timestamptz,
  withdrawn_at timestamptz,
  expelled_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint memberships_status_dates check (
    (status <> 'dormant' or dormant_at is not null)
    and (status <> 'withdrawn' or withdrawn_at is not null)
    and (status <> 'expelled' or expelled_at is not null)
  )
);

create table if not exists public.member_grade_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  from_grade public.member_grade,
  to_grade public.member_grade not null,
  reason_code public.history_reason_code not null,
  reason_text text,
  changed_by uuid references public.profiles(id) on delete restrict,
  source_entity_type text,
  source_entity_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.member_status_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  from_status public.member_status,
  to_status public.member_status not null,
  reason_code public.history_reason_code not null,
  reason_text text,
  changed_by uuid references public.profiles(id) on delete restrict,
  source_entity_type text,
  source_entity_id uuid,
  created_at timestamptz not null default now()
);

-- =========================================================
-- 4. OPERATOR ROLES
-- =========================================================

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  is_system_role boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.member_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  role_id uuid not null references public.roles(id) on delete restrict,
  assigned_by uuid references public.profiles(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,

  constraint member_roles_dates check (
    expires_at is null or expires_at > assigned_at
  )
);

create unique index if not exists uq_member_roles_active
  on public.member_roles(user_id, role_id)
  where revoked_at is null;

insert into public.roles (code, name, description)
values
  ('super_admin', '최고관리자', '전체 관리 및 운영진 권한 관리'),
  ('member_admin', '회원관리 임원', '회원 등급·상태·승급 및 개인정보 관리'),
  ('meeting_admin', '모임 운영진', '담당 모임과 신청자 관리'),
  ('point_admin', '포인트 운영진', '포인트 규칙과 거래 관리'),
  ('review_admin', '승급 관리 임원', '내부 의결 후 승급 결과 처리')
on conflict (code) do update
set name = excluded.name,
    description = excluded.description;

-- =========================================================
-- 5. AUDIT AND PRIVATE ACCESS LOGS
-- =========================================================

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  reason text,
  request_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.private_profile_access_logs (
  id bigint generated always as identity primary key,
  viewer_id uuid not null references public.profiles(id) on delete restrict,
  subject_user_id uuid not null references public.profiles(id) on delete restrict,
  meeting_id uuid,
  access_reason text not null,
  fields_accessed text[] not null,
  accessed_at timestamptz not null default now()
);

-- =========================================================
-- 6. MINIMUM MEETING TABLES NEEDED BY PRIVATE PROFILE RPC
-- Full meeting implementation is provided in the next migration.
-- =========================================================

do $$ begin
  create type public.meeting_status as enum (
    'pending_approval', 'recruiting', 'active', 'ended', 'cancelled', 'rejected'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.application_status as enum ('pending', 'approved', 'rejected', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.manager_type as enum ('host', 'managing_operator');
exception when duplicate_object then null;
end $$;

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status public.meeting_status not null default 'pending_approval',
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.meeting_managers (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  manager_type public.manager_type not null,
  is_primary boolean not null default false,
  assigned_by uuid references public.profiles(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz
);

create unique index if not exists uq_meeting_primary_manager
  on public.meeting_managers(meeting_id)
  where is_primary = true and ended_at is null;

create table if not exists public.meeting_applications (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete restrict,
  applicant_id uuid not null references public.profiles(id) on delete restrict,
  status public.application_status not null default 'pending',
  application_type text not null default 'normal'
    check (application_type in ('normal', 'host', 'operator')),
  created_by_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint uq_meeting_applicant unique(meeting_id, applicant_id)
);

-- =========================================================
-- 7. AUTH USER BOOTSTRAP
-- =========================================================

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nickname)
  values (
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'nickname', '')), '')
  );

  insert into public.profile_private (
    user_id,
    legal_name,
    gender,
    birth_date,
    phone
  )
  values (
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'legal_name', '')), ''),
    case
      when new.raw_user_meta_data ->> 'gender' in ('female', 'male', 'undisclosed')
        then (new.raw_user_meta_data ->> 'gender')::public.gender_type
      else null
    end,
    case
      when coalesce(new.raw_user_meta_data ->> 'birth_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
        then (new.raw_user_meta_data ->> 'birth_date')::date
      else null
    end,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'phone', '')), '')
  );

  insert into public.memberships (user_id)
  values (new.id);

  insert into public.member_grade_history (
    user_id, from_grade, to_grade, reason_code, reason_text, changed_by
  )
  values (
    new.id, null, 'associate', 'signup', '신규 가입 기본 등급', null
  );

  insert into public.member_status_history (
    user_id, from_status, to_status, reason_code, reason_text, changed_by
  )
  values (
    new.id, null, 'active', 'signup', '신규 가입 기본 상태', null
  );

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

-- =========================================================
-- 8. AUTHORIZATION HELPERS
-- =========================================================

create or replace function public.has_active_role(p_role_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.member_roles mr
    join public.roles r on r.id = mr.role_id
    where mr.user_id = (select auth.uid())
      and r.code = p_role_code
      and mr.revoked_at is null
      and (mr.expires_at is null or mr.expires_at > now())
  );
$$;

revoke all on function public.has_active_role(text) from public, anon;
grant execute on function public.has_active_role(text) to authenticated;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_active_role('super_admin');
$$;

revoke all on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated;

create or replace function public.can_manage_meeting(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_super_admin()
    or exists (
      select 1
      from public.meetings m
      where m.id = p_meeting_id
        and m.created_by = (select auth.uid())
        and m.deleted_at is null
    )
    or exists (
      select 1
      from public.meeting_managers mm
      where mm.meeting_id = p_meeting_id
        and mm.user_id = (select auth.uid())
        and mm.ended_at is null
    );
$$;

revoke all on function public.can_manage_meeting(uuid) from public, anon;
grant execute on function public.can_manage_meeting(uuid) to authenticated;

-- =========================================================
-- 9. SAFE RPC FOR APPLICANT PRIVATE DATA
-- Direct SELECT on profile_private is intentionally blocked.
-- =========================================================

create or replace function public.get_meeting_applicant_private_profiles(p_meeting_id uuid)
returns table (
  user_id uuid,
  application_id uuid,
  application_status public.application_status,
  legal_name text,
  gender public.gender_type,
  birth_date date,
  phone text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := (select auth.uid());
begin
  if v_viewer is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if not public.can_manage_meeting(p_meeting_id) then
    raise exception 'MEETING_ACCESS_DENIED' using errcode = '42501';
  end if;

  insert into public.private_profile_access_logs (
    viewer_id,
    subject_user_id,
    meeting_id,
    access_reason,
    fields_accessed
  )
  select
    v_viewer,
    ma.applicant_id,
    p_meeting_id,
    case
      when exists (
        select 1 from public.meetings m
        where m.id = p_meeting_id and m.created_by = v_viewer
      ) then 'meeting_creator'
      when public.has_active_role('member_admin') or public.is_super_admin()
        then 'member_admin'
      else 'meeting_manager'
    end,
    array['legal_name', 'gender', 'birth_date', 'phone']
  from public.meeting_applications ma
  join public.memberships ms on ms.user_id = ma.applicant_id
  where ma.meeting_id = p_meeting_id
    and ms.status not in ('withdrawn', 'expelled');

  return query
  select
    ma.applicant_id,
    ma.id,
    ma.status,
    pp.legal_name,
    pp.gender,
    pp.birth_date,
    pp.phone
  from public.meeting_applications ma
  join public.profile_private pp on pp.user_id = ma.applicant_id
  join public.memberships ms on ms.user_id = ma.applicant_id
  where ma.meeting_id = p_meeting_id
    and ms.status not in ('withdrawn', 'expelled')
    and pp.retention_status <> 'destroyed'
  order by ma.created_at asc;
end;
$$;

revoke all on function public.get_meeting_applicant_private_profiles(uuid) from public, anon;
grant execute on function public.get_meeting_applicant_private_profiles(uuid) to authenticated;

-- =========================================================
-- 10. MEMBER ADMIN RPCs
-- =========================================================

create or replace function public.change_member_status(
  p_user_id uuid,
  p_to_status public.member_status,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_from public.member_status;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if not (
    public.has_active_role('member_admin')
    or public.is_super_admin()
  ) then
    raise exception 'MEMBER_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;

  select status into v_from
  from public.memberships
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_from = p_to_status then
    return;
  end if;

  update public.memberships
  set status = p_to_status,
      status_started_at = now(),
      dormant_at = case when p_to_status = 'dormant' then now() else dormant_at end,
      withdrawn_at = case when p_to_status = 'withdrawn' then now() else withdrawn_at end,
      expelled_at = case when p_to_status = 'expelled' then now() else expelled_at end,
      updated_at = now()
  where user_id = p_user_id;

  if p_to_status = 'withdrawn' then
    update public.profile_private
    set retention_status = 'pending_destruction',
        retention_until = current_date + interval '1 year',
        updated_at = now()
    where user_id = p_user_id;
  end if;

  insert into public.member_status_history (
    user_id, from_status, to_status, reason_code, reason_text, changed_by
  )
  values (
    p_user_id,
    v_from,
    p_to_status,
    case p_to_status
      when 'dormant' then 'half_year_inactivity'::public.history_reason_code
      when 'withdrawn' then 'withdrawal'::public.history_reason_code
      when 'expelled' then 'expulsion'::public.history_reason_code
      else 'manual_change'::public.history_reason_code
    end,
    p_reason,
    v_actor
  );

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, before_data, after_data, reason
  )
  values (
    v_actor,
    'change_member_status',
    'membership',
    p_user_id,
    jsonb_build_object('status', v_from),
    jsonb_build_object('status', p_to_status),
    p_reason
  );
end;
$$;

revoke all on function public.change_member_status(uuid, public.member_status, text)
  from public, anon;
grant execute on function public.change_member_status(uuid, public.member_status, text)
  to authenticated;

-- =========================================================
-- 11. UPDATED-AT TRIGGERS
-- =========================================================

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists set_profile_private_updated_at on public.profile_private;
create trigger set_profile_private_updated_at
  before update on public.profile_private
  for each row execute function public.set_updated_at();

drop trigger if exists set_memberships_updated_at on public.memberships;
create trigger set_memberships_updated_at
  before update on public.memberships
  for each row execute function public.set_updated_at();

drop trigger if exists set_meetings_updated_at on public.meetings;
create trigger set_meetings_updated_at
  before update on public.meetings
  for each row execute function public.set_updated_at();

drop trigger if exists set_meeting_applications_updated_at on public.meeting_applications;
create trigger set_meeting_applications_updated_at
  before update on public.meeting_applications
  for each row execute function public.set_updated_at();

-- =========================================================
-- 12. INDEXES
-- =========================================================

create index if not exists idx_memberships_status on public.memberships(status);
create index if not exists idx_member_roles_user_active
  on public.member_roles(user_id) where revoked_at is null;
create index if not exists idx_meetings_created_by on public.meetings(created_by);
create index if not exists idx_meeting_managers_user_active
  on public.meeting_managers(user_id, meeting_id) where ended_at is null;
create index if not exists idx_meeting_applications_meeting
  on public.meeting_applications(meeting_id, created_at);
create index if not exists idx_private_access_viewer_date
  on public.private_profile_access_logs(viewer_id, accessed_at desc);
create index if not exists idx_status_history_user_date
  on public.member_status_history(user_id, created_at desc);
create index if not exists idx_grade_history_user_date
  on public.member_grade_history(user_id, created_at desc);

-- =========================================================
-- 13. RLS
-- =========================================================

alter table public.profiles enable row level security;
alter table public.profile_private enable row level security;
alter table public.memberships enable row level security;
alter table public.member_grade_history enable row level security;
alter table public.member_status_history enable row level security;
alter table public.roles enable row level security;
alter table public.member_roles enable row level security;
alter table public.audit_logs enable row level security;
alter table public.private_profile_access_logs enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_managers enable row level security;
alter table public.meeting_applications enable row level security;

-- profiles: self or authorized admins; meeting-specific applicant data should use RPC.
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or public.has_active_role('member_admin')
  or public.is_super_admin()
);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- profile_private: only self and member admins.
-- Meeting creator/operator access is exclusively through RPC so access can be logged.
drop policy if exists profile_private_select_self_admin on public.profile_private;
create policy profile_private_select_self_admin
on public.profile_private
for select
to authenticated
using (
  user_id = (select auth.uid())
  or public.has_active_role('member_admin')
  or public.is_super_admin()
);

drop policy if exists profile_private_update_self on public.profile_private;
create policy profile_private_update_self
on public.profile_private
for update
to authenticated
using (
  user_id = (select auth.uid())
  and retention_status = 'active'
)
with check (
  user_id = (select auth.uid())
  and retention_status = 'active'
);

drop policy if exists memberships_select_self_admin on public.memberships;
create policy memberships_select_self_admin
on public.memberships
for select
to authenticated
using (
  user_id = (select auth.uid())
  or public.has_active_role('member_admin')
  or public.is_super_admin()
);

drop policy if exists member_grade_history_select_self_admin on public.member_grade_history;
create policy member_grade_history_select_self_admin
on public.member_grade_history
for select
to authenticated
using (
  user_id = (select auth.uid())
  or public.has_active_role('member_admin')
  or public.is_super_admin()
);

drop policy if exists member_status_history_select_self_admin on public.member_status_history;
create policy member_status_history_select_self_admin
on public.member_status_history
for select
to authenticated
using (
  user_id = (select auth.uid())
  or public.has_active_role('member_admin')
  or public.is_super_admin()
);

drop policy if exists roles_select_authenticated on public.roles;
create policy roles_select_authenticated
on public.roles
for select
to authenticated
using (true);

drop policy if exists member_roles_select_self_admin on public.member_roles;
create policy member_roles_select_self_admin
on public.member_roles
for select
to authenticated
using (
  user_id = (select auth.uid())
  or public.is_super_admin()
);

drop policy if exists audit_logs_select_super_admin on public.audit_logs;
create policy audit_logs_select_super_admin
on public.audit_logs
for select
to authenticated
using (public.is_super_admin());

drop policy if exists private_access_logs_select_admin on public.private_profile_access_logs;
create policy private_access_logs_select_admin
on public.private_profile_access_logs
for select
to authenticated
using (
  viewer_id = (select auth.uid())
  or public.has_active_role('member_admin')
  or public.is_super_admin()
);

drop policy if exists meetings_select_authenticated on public.meetings;
create policy meetings_select_authenticated
on public.meetings
for select
to authenticated
using (deleted_at is null);

drop policy if exists meetings_insert_authenticated on public.meetings;
create policy meetings_insert_authenticated
on public.meetings
for insert
to authenticated
with check (created_by = (select auth.uid()));

drop policy if exists meetings_update_manager on public.meetings;
create policy meetings_update_manager
on public.meetings
for update
to authenticated
using (public.can_manage_meeting(id))
with check (public.can_manage_meeting(id));

drop policy if exists meeting_managers_select_related on public.meeting_managers;
create policy meeting_managers_select_related
on public.meeting_managers
for select
to authenticated
using (
  user_id = (select auth.uid())
  or public.can_manage_meeting(meeting_id)
);

drop policy if exists applications_select_related on public.meeting_applications;
create policy applications_select_related
on public.meeting_applications
for select
to authenticated
using (
  applicant_id = (select auth.uid())
  or public.can_manage_meeting(meeting_id)
);

drop policy if exists applications_insert_self on public.meeting_applications;
create policy applications_insert_self
on public.meeting_applications
for insert
to authenticated
with check (
  applicant_id = (select auth.uid())
  and application_type = 'normal'
  and created_by_system = false
);

-- Explicit grants. RLS remains the final row-level guard.
revoke all on all tables in schema public from anon;
grant select, update on public.profiles to authenticated;
grant select, update on public.profile_private to authenticated;
grant select on public.memberships to authenticated;
grant select on public.member_grade_history to authenticated;
grant select on public.member_status_history to authenticated;
grant select on public.roles to authenticated;
grant select on public.member_roles to authenticated;
grant select on public.audit_logs to authenticated;
grant select on public.private_profile_access_logs to authenticated;
grant select, insert, update on public.meetings to authenticated;
grant select, insert on public.meeting_applications to authenticated;
grant select on public.meeting_managers to authenticated;

commit;
