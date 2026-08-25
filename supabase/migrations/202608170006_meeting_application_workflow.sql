-- =========================================================
-- PRD-005: Secure Meeting Application Workflow
-- RPCs for apply, review, cancel. No direct UPDATE grant.
-- =========================================================

-- 1. Add rejection_reason column
alter table public.meeting_applications
  add column if not exists rejection_reason text;

-- Constraint: rejected must have reason, others must not
alter table public.meeting_applications
  drop constraint if exists applications_rejection_reason_check;
alter table public.meeting_applications
  add constraint applications_rejection_reason_check
  check (
    (status = 'rejected' and rejection_reason is not null and trim(rejection_reason) != '')
    or (status != 'rejected' and rejection_reason is null)
  );

-- 2. Revoke direct INSERT from authenticated; applications go through RPC only
-- First drop the existing INSERT policy
drop policy if exists applications_insert_self on public.meeting_applications;

-- Revoke INSERT grant (SELECT remains)
revoke insert on public.meeting_applications from authenticated;

-- Grant INSERT only to the RPC (SECURITY DEFINER handles it)
-- No direct INSERT policy needed since privilege is revoked.

-- 3. Application creation RPC
create or replace function public.apply_to_meeting(p_meeting_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_applicant uuid := (select auth.uid());
  v_meeting record;
  v_grade text;
  v_app_id uuid;
begin
  -- Auth
  if v_applicant is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  -- Fetch meeting
  select id, status, created_by, regular_only
  into v_meeting
  from public.meetings
  where id = p_meeting_id and deleted_at is null
  for share;

  if not found then
    raise exception 'MEETING_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Must be recruiting
  if v_meeting.status != 'recruiting' then
    raise exception 'MEETING_NOT_RECRUITING' using errcode = '22023';
  end if;

  -- Cannot apply to own meeting (creator participates automatically)
  if v_meeting.created_by = v_applicant then
    raise exception 'CREATOR_CANNOT_APPLY' using errcode = '22023';
  end if;

  -- Duplicate check (also enforced by unique constraint)
  if exists (
    select 1 from public.meeting_applications
    where meeting_id = p_meeting_id and applicant_id = v_applicant
  ) then
    raise exception 'ALREADY_APPLIED' using errcode = '23505';
  end if;

  -- Regular-only eligibility
  if v_meeting.regular_only then
    select m.grade into v_grade
    from public.memberships m
    where m.user_id = v_applicant;

    -- associate without operator role cannot join regular_only
    if v_grade = 'associate' then
      -- Check if operator (operators can join regardless of grade)
      if not exists (
        select 1 from public.member_roles mr
        where mr.user_id = v_applicant
          and mr.revoked_at is null
          and (mr.expires_at is null or mr.expires_at > now())
      ) then
        raise exception 'REGULAR_ONLY_MEETING' using errcode = '42501';
      end if;
    end if;
  end if;

  -- Insert application
  insert into public.meeting_applications (
    meeting_id, applicant_id, status, application_type, created_by_system
  ) values (
    p_meeting_id, v_applicant, 'pending', 'normal', false
  )
  returning id into v_app_id;

  return v_app_id;
end;
$$;

revoke all on function public.apply_to_meeting(uuid) from public, anon;
grant execute on function public.apply_to_meeting(uuid) to authenticated;

-- 4. Application review RPC (approve/reject)
create or replace function public.review_meeting_application(
  p_application_id uuid,
  p_decision text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_app record;
  v_capacity integer;
  v_approved_count integer;
begin
  -- Auth
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  -- Validate decision
  if p_decision not in ('approve', 'reject') then
    raise exception 'INVALID_DECISION' using errcode = '22023';
  end if;

  -- Fetch application with lock
  select a.id, a.meeting_id, a.applicant_id, a.status
  into v_app
  from public.meeting_applications a
  where a.id = p_application_id
  for update;

  if not found then
    raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Authorization: must be able to manage this meeting
  if not public.can_manage_meeting(v_app.meeting_id) then
    raise exception 'MEETING_ACCESS_DENIED' using errcode = '42501';
  end if;

  -- Must be pending
  if v_app.status != 'pending' then
    raise exception 'APPLICATION_NOT_PENDING' using errcode = '22023';
  end if;

  -- APPROVE
  if p_decision = 'approve' then
    -- Capacity check
    select capacity into v_capacity
    from public.meetings
    where id = v_app.meeting_id;

    if v_capacity is not null then
      select count(*) into v_approved_count
      from public.meeting_applications
      where meeting_id = v_app.meeting_id
        and status = 'approved';

      -- +1 for creator who participates automatically
      if v_approved_count + 1 >= v_capacity then
        raise exception 'MEETING_CAPACITY_FULL' using errcode = '22023';
      end if;
    end if;

    update public.meeting_applications
    set status = 'approved',
        rejection_reason = null,
        updated_at = now()
    where id = p_application_id;

  -- REJECT
  else
    if nullif(trim(coalesce(p_reason, '')), '') is null then
      raise exception 'REJECTION_REASON_REQUIRED' using errcode = '22023';
    end if;

    update public.meeting_applications
    set status = 'rejected',
        rejection_reason = trim(p_reason),
        updated_at = now()
    where id = p_application_id;
  end if;
end;
$$;

revoke all on function public.review_meeting_application(uuid, text, text) from public, anon;
grant execute on function public.review_meeting_application(uuid, text, text) to authenticated;

-- 5. Cancellation RPC
create or replace function public.cancel_meeting_application(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_app record;
  v_meeting_status text;
begin
  -- Auth
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  -- Fetch application
  select a.id, a.meeting_id, a.applicant_id, a.status
  into v_app
  from public.meeting_applications a
  where a.id = p_application_id
  for update;

  if not found then
    raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Must be own application
  if v_app.applicant_id != v_actor then
    raise exception 'NOT_OWN_APPLICATION' using errcode = '42501';
  end if;

  -- Must be pending or approved
  if v_app.status not in ('pending', 'approved') then
    raise exception 'CANNOT_CANCEL_STATUS' using errcode = '22023';
  end if;

  -- Meeting must not be active or ended
  select m.status::text into v_meeting_status
  from public.meetings m
  where m.id = v_app.meeting_id;

  if v_meeting_status in ('active', 'ended') then
    raise exception 'MEETING_ALREADY_ACTIVE' using errcode = '22023';
  end if;

  update public.meeting_applications
  set status = 'cancelled',
      rejection_reason = null,
      updated_at = now()
  where id = p_application_id;
end;
$$;

revoke all on function public.cancel_meeting_application(uuid) from public, anon;
grant execute on function public.cancel_meeting_application(uuid) to authenticated;
