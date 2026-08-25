-- =========================================================
-- Block associate applications to regular_networking meetings
-- =========================================================

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
  v_is_operator boolean;
  v_app_id uuid;
begin
  -- Auth
  if v_applicant is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  -- Fetch meeting
  select id, status, created_by, regular_only, meeting_type
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

  -- Get applicant grade and operator status
  select m.grade into v_grade
  from public.memberships m
  where m.user_id = v_applicant;

  select exists (
    select 1 from public.member_roles mr
    where mr.user_id = v_applicant
      and mr.revoked_at is null
      and (mr.expires_at is null or mr.expires_at > now())
  ) into v_is_operator;

  -- Regular networking: associate without operator role cannot apply
  if v_meeting.meeting_type = 'regular_networking'::public.meeting_type then
    if v_grade = 'associate' and not v_is_operator then
      raise exception 'REGULAR_NETWORKING_NOT_ELIGIBLE' using errcode = '42501';
    end if;
  end if;

  -- Regular-only eligibility
  if v_meeting.regular_only then
    if v_grade = 'associate' and not v_is_operator then
      raise exception 'REGULAR_ONLY_MEETING' using errcode = '42501';
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
