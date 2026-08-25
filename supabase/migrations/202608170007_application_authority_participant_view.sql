-- =========================================================
-- Fix application review authority (creator only),
-- add approved-participant read RPC,
-- auto-apply assigned operator on meeting approval.
-- =========================================================

-- 1. Replace review_meeting_application: creator-only authorization
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
  v_meeting_creator uuid;
  v_capacity integer;
  v_approved_count integer;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

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

  -- Authorization: ONLY meeting creator may review
  select m.created_by into v_meeting_creator
  from public.meetings m
  where m.id = v_app.meeting_id;

  if v_meeting_creator != v_actor then
    raise exception 'CREATOR_ONLY' using errcode = '42501';
  end if;

  if v_app.status != 'pending' then
    raise exception 'APPLICATION_NOT_PENDING' using errcode = '22023';
  end if;

  -- APPROVE
  if p_decision = 'approve' then
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

-- 2. Approved participant list RPC (any authenticated member who can view the meeting)
create or replace function public.get_meeting_approved_participants(p_meeting_id uuid)
returns table (
  user_id uuid,
  legal_name text,
  profile_image_path text,
  company_name text,
  job_title text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  -- Verify meeting exists and is visible
  if not exists (
    select 1 from public.meetings m
    where m.id = p_meeting_id and m.deleted_at is null
  ) then
    raise exception 'MEETING_NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
    select
      a.applicant_id as user_id,
      pp.legal_name,
      p.profile_image_path,
      p.company_name,
      p.job_title
    from public.meeting_applications a
    join public.profiles p on p.id = a.applicant_id
    left join public.profile_private pp on pp.user_id = a.applicant_id
    where a.meeting_id = p_meeting_id
      and a.status = 'approved';
end;
$$;

revoke all on function public.get_meeting_approved_participants(uuid) from public, anon;
grant execute on function public.get_meeting_approved_participants(uuid) to authenticated;

-- 3. Extend review_meeting to auto-create approved application for assigned operator
create or replace function public.review_meeting(
  p_meeting_id uuid,
  p_decision text,
  p_assigned_operator_id uuid default null,
  p_rejection_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_current_status text;
  v_meeting_creator uuid;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if not (
    public.has_active_role('meeting_admin')
    or public.is_super_admin()
  ) then
    raise exception 'MEETING_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise exception 'INVALID_DECISION' using errcode = '22023';
  end if;

  select status::text, created_by
  into v_current_status, v_meeting_creator
  from public.meetings
  where id = p_meeting_id and deleted_at is null
  for update;

  if not found then
    raise exception 'MEETING_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_current_status != 'pending_approval' then
    raise exception 'NOT_PENDING_APPROVAL' using errcode = '22023';
  end if;

  -- APPROVE
  if p_decision = 'approve' then
    if p_assigned_operator_id is null then
      raise exception 'ASSIGNED_OPERATOR_REQUIRED' using errcode = '22023';
    end if;

    if not exists (
      select 1 from public.member_roles mr
      where mr.user_id = p_assigned_operator_id
        and mr.revoked_at is null
        and (mr.expires_at is null or mr.expires_at > now())
    ) then
      raise exception 'ASSIGNED_USER_NOT_OPERATOR' using errcode = '22023';
    end if;

    update public.meetings
    set status = 'recruiting',
        reviewed_by = v_actor,
        reviewed_at = now(),
        updated_at = now()
    where id = p_meeting_id;

    -- Assign managing operator
    update public.meeting_managers
    set ended_at = now()
    where meeting_id = p_meeting_id
      and manager_type = 'managing_operator'
      and ended_at is null;

    insert into public.meeting_managers (
      meeting_id, user_id, manager_type, is_primary, assigned_by, assigned_at
    ) values (
      p_meeting_id, p_assigned_operator_id, 'managing_operator', false, v_actor, now()
    );

    -- Auto-apply assigned operator as approved participant
    -- Skip if operator is the meeting creator (creator participates automatically)
    -- Skip if application already exists
    if p_assigned_operator_id != v_meeting_creator then
      if not exists (
        select 1 from public.meeting_applications
        where meeting_id = p_meeting_id and applicant_id = p_assigned_operator_id
      ) then
        insert into public.meeting_applications (
          meeting_id, applicant_id, status, application_type, created_by_system
        ) values (
          p_meeting_id, p_assigned_operator_id, 'approved', 'operator', true
        );
      end if;
    end if;

  -- REJECT
  else
    if nullif(trim(coalesce(p_rejection_reason, '')), '') is null then
      raise exception 'REJECTION_REASON_REQUIRED' using errcode = '22023';
    end if;

    update public.meetings
    set status = 'rejected',
        rejection_reason = trim(p_rejection_reason),
        reviewed_by = v_actor,
        reviewed_at = now(),
        updated_at = now()
    where id = p_meeting_id;
  end if;
end;
$$;
