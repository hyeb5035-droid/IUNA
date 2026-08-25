-- =========================================================
-- Project Point Value: selected at approval, awarded on completion
-- =========================================================

-- 1. Add project_point_value to meetings
alter table public.meetings
  add column if not exists project_point_value smallint;

-- Constraint: only 3, 4, or 5 allowed; only for project type
alter table public.meetings
  drop constraint if exists meetings_project_point_value_check;
alter table public.meetings
  add constraint meetings_project_point_value_check
  check (
    project_point_value is null
    or (meeting_type = 'project' and project_point_value in (3, 4, 5))
  );

-- 2. Add project_completed to point_event_type enum
alter type public.point_event_type add value if not exists 'project_completed';

-- 3. Extend review_meeting: require project_point_value for project approval
create or replace function public.review_meeting(
  p_meeting_id uuid,
  p_decision text,
  p_assigned_operator_id uuid default null,
  p_rejection_reason text default null,
  p_project_point_value smallint default null
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
  v_meeting_type text;
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

  select status::text, created_by, meeting_type::text
  into v_current_status, v_meeting_creator, v_meeting_type
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

    -- Project meetings require point value
    if v_meeting_type = 'project' then
      if p_project_point_value is null or p_project_point_value not in (3, 4, 5) then
        raise exception 'PROJECT_POINT_VALUE_REQUIRED' using errcode = '22023';
      end if;
    end if;

    update public.meetings
    set status = 'recruiting',
        reviewed_by = v_actor,
        reviewed_at = now(),
        updated_at = now(),
        project_point_value = case when v_meeting_type = 'project' then p_project_point_value else null end
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

-- 4. Extend set_participant_completion: project completion points
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
  v_meeting_type text;
  v_project_points smallint;
  v_current_study_points integer;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select id, status, created_by, meeting_type::text, project_point_value
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

  select id into v_app_id
  from public.meeting_applications
  where meeting_id = p_meeting_id
    and applicant_id = p_participant_id
    and status = 'approved'
  for update;

  if not found then
    raise exception 'PARTICIPANT_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_meeting_type := v_meeting.meeting_type;
  v_project_points := v_meeting.project_point_value;

  update public.meeting_applications
  set completed = p_completed,
      completed_at = now(),
      completed_by = v_actor,
      updated_at = now()
  where id = v_app_id;

  -- Issue completion points only when marked completed
  if p_completed = true then
    if v_meeting_type = 'study' then
      v_current_study_points := public._study_points_for_meeting(p_participant_id, p_meeting_id);
      if v_current_study_points + 2 <= 3 then
        perform public._insert_point_if_not_exists(
          p_participant_id, p_meeting_id,
          'study_completed'::public.point_event_type, 2
        );
      elsif v_current_study_points < 3 then
        perform public._insert_point_if_not_exists(
          p_participant_id, p_meeting_id,
          'study_completed'::public.point_event_type, 3 - v_current_study_points
        );
      end if;

    elsif v_meeting_type = 'lecture' then
      perform public._insert_point_if_not_exists(
        p_participant_id, p_meeting_id,
        'lecture_completed'::public.point_event_type, 2
      );

    elsif v_meeting_type = 'lightning' then
      perform public._insert_point_if_not_exists(
        p_participant_id, p_meeting_id,
        'lightning_completed'::public.point_event_type, 1
      );

    elsif v_meeting_type = 'project' then
      if v_project_points is not null then
        perform public._insert_point_if_not_exists(
          p_participant_id, p_meeting_id,
          'project_completed'::public.point_event_type, v_project_points
        );
      end if;
    end if;
  end if;
end;
$$;
