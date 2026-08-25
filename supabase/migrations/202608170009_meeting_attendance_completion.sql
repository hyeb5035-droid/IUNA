-- =========================================================
-- Meeting Attendance/Completion + Lifecycle RPCs
-- =========================================================

-- 1. Add completion fields to meeting_applications
alter table public.meeting_applications
  add column if not exists completed boolean,
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid references public.profiles(id) on delete restrict;

-- Constraint: completed fields only on approved applications
alter table public.meeting_applications
  drop constraint if exists applications_completion_check;
alter table public.meeting_applications
  add constraint applications_completion_check
  check (
    (completed is null and completed_at is null and completed_by is null)
    or (status = 'approved' and completed is not null and completed_at is not null and completed_by is not null)
  );

-- 2. Start meeting: recruiting → active (creator only)
create or replace function public.start_meeting(p_meeting_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_meeting record;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select id, status, created_by
  into v_meeting
  from public.meetings
  where id = p_meeting_id and deleted_at is null
  for update;

  if not found then
    raise exception 'MEETING_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_meeting.created_by != v_actor then
    raise exception 'CREATOR_ONLY' using errcode = '42501';
  end if;

  if v_meeting.status != 'recruiting' then
    raise exception 'NOT_RECRUITING' using errcode = '22023';
  end if;

  update public.meetings
  set status = 'active', updated_at = now()
  where id = p_meeting_id;
end;
$$;

revoke all on function public.start_meeting(uuid) from public, anon;
grant execute on function public.start_meeting(uuid) to authenticated;

-- 3. Set participant completion (creator only, meeting must be active)
create or replace function public.set_participant_completion(
  p_meeting_id uuid,
  p_participant_id uuid,
  p_completed boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_meeting record;
  v_app_id uuid;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select id, status, created_by
  into v_meeting
  from public.meetings
  where id = p_meeting_id and deleted_at is null;

  if not found then
    raise exception 'MEETING_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_meeting.created_by != v_actor then
    raise exception 'CREATOR_ONLY' using errcode = '42501';
  end if;

  if v_meeting.status != 'active' then
    raise exception 'MEETING_NOT_ACTIVE' using errcode = '22023';
  end if;

  -- Find the approved application for this participant
  select id into v_app_id
  from public.meeting_applications
  where meeting_id = p_meeting_id
    and applicant_id = p_participant_id
    and status = 'approved'
  for update;

  if not found then
    raise exception 'PARTICIPANT_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.meeting_applications
  set completed = p_completed,
      completed_at = now(),
      completed_by = v_actor,
      updated_at = now()
  where id = v_app_id;
end;
$$;

revoke all on function public.set_participant_completion(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_participant_completion(uuid, uuid, boolean) to authenticated;

-- 4. End meeting: active → ended (creator only, all participants must have completion decision)
create or replace function public.end_meeting(p_meeting_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_meeting record;
  v_unresolved integer;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select id, status, created_by
  into v_meeting
  from public.meetings
  where id = p_meeting_id and deleted_at is null
  for update;

  if not found then
    raise exception 'MEETING_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_meeting.created_by != v_actor then
    raise exception 'CREATOR_ONLY' using errcode = '42501';
  end if;

  if v_meeting.status != 'active' then
    raise exception 'MEETING_NOT_ACTIVE' using errcode = '22023';
  end if;

  -- Check all approved participants have completion decision
  select count(*) into v_unresolved
  from public.meeting_applications
  where meeting_id = p_meeting_id
    and status = 'approved'
    and completed is null;

  if v_unresolved > 0 then
    raise exception 'UNRESOLVED_PARTICIPANTS' using errcode = '22023';
  end if;

  update public.meetings
  set status = 'ended', updated_at = now()
  where id = p_meeting_id;
end;
$$;

revoke all on function public.end_meeting(uuid) from public, anon;
grant execute on function public.end_meeting(uuid) to authenticated;

-- 5. Creator participation: ensure creator has an approved application row
-- This handles the case where creator doesn't have an application row yet.
-- Called automatically when meeting starts.
create or replace function public.ensure_creator_participation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only on status change to 'active'
  if new.status = 'active' and old.status = 'recruiting' then
    if not exists (
      select 1 from public.meeting_applications
      where meeting_id = new.id and applicant_id = new.created_by
    ) then
      insert into public.meeting_applications (
        meeting_id, applicant_id, status, application_type, created_by_system
      ) values (
        new.id, new.created_by, 'approved', 'host', true
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ensure_creator_participation on public.meetings;
create trigger trg_ensure_creator_participation
  after update on public.meetings
  for each row
  execute function public.ensure_creator_participation();
