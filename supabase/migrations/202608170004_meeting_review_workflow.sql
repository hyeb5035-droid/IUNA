-- =========================================================
-- Meeting Review Workflow
-- Adds rejection_reason column and review_meeting RPC
-- =========================================================

-- 1. Add rejection_reason to meetings
alter table public.meetings
  add column if not exists rejection_reason text,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete restrict,
  add column if not exists reviewed_at timestamptz;

-- 2. Atomic review function
create or replace function public.review_meeting(
  p_meeting_id uuid,
  p_decision text,             -- 'approve' or 'reject'
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
begin
  -- Auth check
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  -- Role check: meeting_admin or super_admin only
  if not (
    public.has_active_role('meeting_admin')
    or public.is_super_admin()
  ) then
    raise exception 'MEETING_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  -- Validate decision
  if p_decision not in ('approve', 'reject') then
    raise exception 'INVALID_DECISION' using errcode = '22023';
  end if;

  -- Lock and verify current status
  select status::text into v_current_status
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
    -- Must have assigned operator
    if p_assigned_operator_id is null then
      raise exception 'ASSIGNED_OPERATOR_REQUIRED' using errcode = '22023';
    end if;

    -- Verify assigned operator is an active operator
    if not exists (
      select 1 from public.member_roles mr
      where mr.user_id = p_assigned_operator_id
        and mr.revoked_at is null
        and (mr.expires_at is null or mr.expires_at > now())
    ) then
      raise exception 'ASSIGNED_USER_NOT_OPERATOR' using errcode = '22023';
    end if;

    -- Update meeting status
    update public.meetings
    set status = 'recruiting',
        reviewed_by = v_actor,
        reviewed_at = now(),
        updated_at = now()
    where id = p_meeting_id;

    -- Assign 담당 운영진 (managing_operator)
    -- End any existing managing_operator first
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

  -- REJECT
  else
    -- Must have reason
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

revoke all on function public.review_meeting(uuid, text, uuid, text) from public, anon;
grant execute on function public.review_meeting(uuid, text, uuid, text) to authenticated;
