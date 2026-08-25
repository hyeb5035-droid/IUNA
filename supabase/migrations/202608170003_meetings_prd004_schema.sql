-- =========================================================
-- PRD-004: Extend meetings table with required fields,
--          enforce creation authorization at DB level,
--          auto-assign creator as primary meeting manager.
-- =========================================================

-- 1. Meeting type enum
do $$ begin
  create type public.meeting_type as enum (
    'lecture',
    'study',
    'project',
    'lightning',
    'regular_networking'
  );
exception when duplicate_object then null;
end $$;

-- 2. Add columns to meetings (all nullable for existing rows)
alter table public.meetings
  add column if not exists meeting_type public.meeting_type,
  add column if not exists description text,
  add column if not exists goals text,
  add column if not exists details text,
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists capacity integer,
  add column if not exists support_request text,
  add column if not exists regular_only boolean not null default false,
  add column if not exists lecture_fee integer,
  add column if not exists revenue_share_organizer smallint,
  add column if not exists revenue_share_member smallint;

-- 3. Constraints
-- Period: end >= start when both exist
alter table public.meetings
  drop constraint if exists meetings_period_check;
alter table public.meetings
  add constraint meetings_period_check
  check (period_end is null or period_end >= period_start);

-- Capacity: must be positive
alter table public.meetings
  drop constraint if exists meetings_capacity_check;
alter table public.meetings
  add constraint meetings_capacity_check
  check (capacity is null or capacity > 0);

-- Revenue share: both must be set together and sum to 10
alter table public.meetings
  drop constraint if exists meetings_revenue_share_check;
alter table public.meetings
  add constraint meetings_revenue_share_check
  check (
    (revenue_share_organizer is null and revenue_share_member is null)
    or (
      revenue_share_organizer is not null
      and revenue_share_member is not null
      and revenue_share_organizer >= 0
      and revenue_share_member >= 0
      and revenue_share_organizer + revenue_share_member = 10
    )
  );

-- Lecture fee only for lecture type
alter table public.meetings
  drop constraint if exists meetings_lecture_fields_check;
alter table public.meetings
  add constraint meetings_lecture_fields_check
  check (
    meeting_type = 'lecture'
    or (lecture_fee is null and revenue_share_organizer is null and revenue_share_member is null)
  );

-- 4. Authorization helper: can this user create a meeting of this type?
create or replace function public.can_create_meeting(p_meeting_type public.meeting_type)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    -- Must be authenticated
    when (select auth.uid()) is null then false
    -- Associate members cannot create any meeting
    when exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.grade = 'associate'
    ) then false
    -- Regular networking: operator only
    when p_meeting_type = 'regular_networking'::public.meeting_type then (
      exists (
        select 1 from public.member_roles mr
        where mr.user_id = (select auth.uid())
          and mr.revoked_at is null
          and (mr.expires_at is null or mr.expires_at > now())
      )
    )
    -- All other types: regular, honorary, or operator
    else true
  end;
$$;

revoke all on function public.can_create_meeting(public.meeting_type) from public, anon;
grant execute on function public.can_create_meeting(public.meeting_type) to authenticated;

-- 5. Replace meeting INSERT policy with authorization-aware version
drop policy if exists meetings_insert_authenticated on public.meetings;
create policy meetings_insert_authorized
on public.meetings
for insert
to authenticated
with check (
  -- Creator must be self
  created_by = (select auth.uid())
  -- Status must be pending_approval on creation
  and status = 'pending_approval'
  -- Must pass meeting-type authorization
  and public.can_create_meeting(meeting_type)
);

-- 6. Auto-assign creator as primary meeting manager
create or replace function public.auto_assign_meeting_creator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.meeting_managers (
    meeting_id,
    user_id,
    manager_type,
    is_primary,
    assigned_by,
    assigned_at
  )
  values (
    new.id,
    new.created_by,
    'host'::public.manager_type,
    true,
    new.created_by,
    now()
  );
  return new;
end;
$$;

drop trigger if exists trg_auto_assign_meeting_creator on public.meetings;
create trigger trg_auto_assign_meeting_creator
  after insert on public.meetings
  for each row
  execute function public.auto_assign_meeting_creator();

-- 7. Grant meeting_managers INSERT for the trigger (security definer handles it,
--    but if direct insertion is needed by managers later, add explicit policy)
drop policy if exists meeting_managers_insert_system on public.meeting_managers;
create policy meeting_managers_insert_system
on public.meeting_managers
for insert
to authenticated
with check (
  -- Only the trigger (security definer) or super_admin can insert
  public.is_super_admin()
  or public.can_manage_meeting(meeting_id)
);
