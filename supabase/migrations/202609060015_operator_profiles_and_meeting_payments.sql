begin;

-- Payment confirmation audit fields. Existing approved rows remain unchanged.
alter table public.meeting_applications
  add column if not exists payment_confirmed_at timestamptz,
  add column if not exists payment_confirmed_by uuid references public.profiles(id) on delete restrict;

alter table public.meeting_applications
  drop constraint if exists applications_payment_confirmation_check;
alter table public.meeting_applications
  add constraint applications_payment_confirmation_check check (
    (payment_confirmed_at is null) = (payment_confirmed_by is null)
    and (
      payment_confirmed_at is null
      or status in ('approved', 'cancelled')
    )
  );

-- These existing helpers are internal building blocks for trusted RPCs only.
-- SECURITY DEFINER callers owned by the migration role can still invoke them.
revoke all on function public._insert_point_if_not_exists(
  uuid, uuid, public.point_event_type, integer
) from public, anon, authenticated;
revoke all on function public._study_points_for_meeting(uuid, uuid)
  from public, anon, authenticated;

-- Directory data for every official operator role. No auth internals are exposed.
create or replace function public.get_operator_member_directory()
returns table (
  user_id uuid,
  member_no text,
  legal_name text,
  grade public.member_grade,
  status public.member_status,
  joined_at timestamptz,
  total_points integer,
  active_roles jsonb
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
  if not exists (
    select 1
    from public.member_roles mr join public.roles r on r.id = mr.role_id
    where mr.user_id = (select auth.uid())
      and r.code in ('operator', 'member_admin', 'meeting_admin', 'super_admin')
      and mr.revoked_at is null
      and (mr.expires_at is null or mr.expires_at > now())
  ) then
    raise exception 'OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  return query
  select p.id, p.member_no, pp.legal_name, ms.grade, ms.status, p.created_at,
    coalesce((select sum(pt.points)::integer from public.point_transactions pt where pt.user_id = p.id), 0),
    coalesce((
      select jsonb_agg(jsonb_build_object('code', r.code, 'name', r.name, 'assigned_at', mr.assigned_at) order by mr.assigned_at)
      from public.member_roles mr join public.roles r on r.id = mr.role_id
      where mr.user_id = p.id
        and r.code in ('operator', 'member_admin', 'meeting_admin', 'super_admin')
        and mr.revoked_at is null
        and (mr.expires_at is null or mr.expires_at > now())
    ), '[]'::jsonb)
  from public.profiles p
  join public.profile_private pp on pp.user_id = p.id
  join public.memberships ms on ms.user_id = p.id
  where p.deleted_at is null
  order by p.created_at, p.id;
end;
$$;

revoke all on function public.get_operator_member_directory() from public, anon;
grant execute on function public.get_operator_member_directory() to authenticated;

-- Audited single-member private profile lookup for any official operator.
create or replace function public.get_operator_member_detail(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_viewer is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.member_roles mr join public.roles r on r.id = mr.role_id
    where mr.user_id = v_viewer
      and r.code in ('operator', 'member_admin', 'meeting_admin', 'super_admin')
      and mr.revoked_at is null
      and (mr.expires_at is null or mr.expires_at > now())
  ) then
    raise exception 'OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', p.id,
    'member_no', p.member_no,
    'legal_name', pp.legal_name,
    'grade', ms.grade,
    'status', ms.status,
    'joined_at', p.created_at,
    'birth_date', pp.birth_date,
    'gender', pp.gender,
    'email', u.email,
    'nickname', p.nickname,
    'company_name', p.company_name,
    'job_title', p.job_title,
    'introduction', p.introduction,
    'interests', p.interests,
    'total_points', coalesce((select sum(pt.points)::integer from public.point_transactions pt where pt.user_id = p.id), 0),
    'active_roles', coalesce((
      select jsonb_agg(jsonb_build_object('code', r.code, 'name', r.name, 'assigned_at', mr.assigned_at) order by mr.assigned_at)
      from public.member_roles mr join public.roles r on r.id = mr.role_id
      where mr.user_id = p.id
        and r.code in ('operator', 'member_admin', 'meeting_admin', 'super_admin')
        and mr.revoked_at is null
        and (mr.expires_at is null or mr.expires_at > now())
    ), '[]'::jsonb),
    'member_number_history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'member_no', h.member_no, 'number_band', h.number_band,
        'valid_from', h.valid_from, 'valid_to', h.valid_to, 'change_reason', h.change_reason
      ) order by h.valid_from desc)
      from public.member_number_history h where h.user_id = p.id
    ), '[]'::jsonb)
  ) into v_result
  from public.profiles p
  join public.profile_private pp on pp.user_id = p.id and pp.retention_status <> 'destroyed'
  join public.memberships ms on ms.user_id = p.id
  left join auth.users u on u.id = p.id
  where p.id = p_user_id and p.deleted_at is null;

  if v_result is null then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.private_profile_access_logs (
    viewer_id, subject_user_id, meeting_id, access_reason, fields_accessed
  ) values (
    v_viewer, p_user_id, null, 'operator_member_detail',
    array['legal_name', 'birth_date', 'gender', 'email', 'profile', 'membership', 'roles', 'member_number_history']
  );

  return v_result;
end;
$$;

revoke all on function public.get_operator_member_detail(uuid) from public, anon;
grant execute on function public.get_operator_member_detail(uuid) to authenticated;

-- Meeting creator review: approval now reserves capacity and awaits payment.
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
  v_meeting record;
  v_reserved_count integer;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'INVALID_DECISION' using errcode = '22023'; end if;

  select a.id, a.meeting_id, a.applicant_id, a.status into v_app
  from public.meeting_applications a where a.id = p_application_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002'; end if;

  select m.created_by, m.capacity into v_meeting
  from public.meetings m where m.id = v_app.meeting_id for update;
  if v_meeting.created_by <> v_actor then raise exception 'CREATOR_ONLY' using errcode = '42501'; end if;
  if v_app.status <> 'pending' then raise exception 'APPLICATION_NOT_PENDING' using errcode = '22023'; end if;

  if p_decision = 'approve' then
    if v_meeting.capacity is not null then
      select count(*) into v_reserved_count
      from public.meeting_applications
      where meeting_id = v_app.meeting_id and status in ('payment_pending', 'approved');
      if v_reserved_count + 1 >= v_meeting.capacity then
        raise exception 'MEETING_CAPACITY_FULL' using errcode = '22023';
      end if;
    end if;
    update public.meeting_applications
    set status = 'payment_pending', rejection_reason = null, updated_at = now()
    where id = p_application_id;
  else
    if nullif(trim(coalesce(p_reason, '')), '') is null then
      raise exception 'REJECTION_REASON_REQUIRED' using errcode = '22023';
    end if;
    update public.meeting_applications
    set status = 'rejected', rejection_reason = trim(p_reason), updated_at = now()
    where id = p_application_id;
  end if;
end;
$$;

revoke all on function public.review_meeting_application(uuid, text, text) from public, anon;
grant execute on function public.review_meeting_application(uuid, text, text) to authenticated;

-- Only meeting administrators can confirm payment and final participation.
create or replace function public.confirm_meeting_payment(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_app record;
  v_meeting_type text;
  v_current_study_points integer;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if not (public.has_active_role('meeting_admin') or public.is_super_admin()) then
    raise exception 'MEETING_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  select a.id, a.meeting_id, a.applicant_id, a.status into v_app
  from public.meeting_applications a where a.id = p_application_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_app.status <> 'payment_pending' then
    raise exception 'APPLICATION_NOT_PAYMENT_PENDING' using errcode = '22023';
  end if;

  select m.meeting_type::text into v_meeting_type
  from public.meetings m where m.id = v_app.meeting_id;

  update public.meeting_applications
  set status = 'approved', payment_confirmed_at = now(), payment_confirmed_by = v_actor, updated_at = now()
  where id = p_application_id;

  if v_meeting_type = 'study' then
    v_current_study_points := public._study_points_for_meeting(v_app.applicant_id, v_app.meeting_id);
    if v_current_study_points < 3 then
      perform public._insert_point_if_not_exists(
        v_app.applicant_id, v_app.meeting_id,
        'study_application_approved'::public.point_event_type, 1
      );
    end if;
  end if;
end;
$$;

revoke all on function public.confirm_meeting_payment(uuid) from public, anon;
grant execute on function public.confirm_meeting_payment(uuid) to authenticated;

create or replace function public.get_pending_meeting_payments()
returns table (
  application_id uuid,
  meeting_id uuid,
  meeting_title text,
  applicant_id uuid,
  applicant_name text,
  member_no text,
  applied_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_active_role('meeting_admin') or public.is_super_admin()) then
    raise exception 'MEETING_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  return query
  select a.id, a.meeting_id, m.title, a.applicant_id, pp.legal_name, p.member_no, a.created_at
  from public.meeting_applications a
  join public.meetings m on m.id = a.meeting_id
  join public.profiles p on p.id = a.applicant_id
  left join public.profile_private pp on pp.user_id = a.applicant_id
  where a.status = 'payment_pending' and m.deleted_at is null
  order by a.updated_at asc;
end;
$$;

revoke all on function public.get_pending_meeting_payments() from public, anon;
grant execute on function public.get_pending_meeting_payments() to authenticated;

-- Applicant cancellation remains available until meeting activity starts.
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
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select a.id, a.meeting_id, a.applicant_id, a.status into v_app
  from public.meeting_applications a where a.id = p_application_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_app.applicant_id <> v_actor then raise exception 'NOT_OWN_APPLICATION' using errcode = '42501'; end if;
  if v_app.status not in ('pending', 'payment_pending', 'approved') then
    raise exception 'CANNOT_CANCEL_STATUS' using errcode = '22023';
  end if;
  select m.status::text into v_meeting_status from public.meetings m where m.id = v_app.meeting_id;
  if v_meeting_status in ('active', 'ended') then raise exception 'MEETING_ALREADY_ACTIVE' using errcode = '22023'; end if;
  update public.meeting_applications
  set status = 'cancelled', rejection_reason = null, updated_at = now()
  where id = p_application_id;
end;
$$;

revoke all on function public.cancel_meeting_application(uuid) from public, anon;
grant execute on function public.cancel_meeting_application(uuid) to authenticated;

commit;
