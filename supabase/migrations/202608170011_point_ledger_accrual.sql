-- =========================================================
-- Point Ledger + Automatic Accrual
-- =========================================================

-- 1. Event type enum
do $$ begin
  create type public.point_event_type as enum (
    'study_application_approved',
    'study_completed',
    'lecture_completed',
    'lightning_completed'
  );
exception when duplicate_object then null;
end $$;

-- 2. Point transactions table
create table if not exists public.point_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  meeting_id uuid not null references public.meetings(id) on delete restrict,
  event_type public.point_event_type not null,
  points integer not null,
  created_at timestamptz not null default now()
);

-- Duplicate protection: same user + meeting + event = one transaction only
create unique index if not exists uq_point_transaction_user_meeting_event
  on public.point_transactions(user_id, meeting_id, event_type);

-- RLS: no direct user access
alter table public.point_transactions enable row level security;

-- Users can only read their own point history
drop policy if exists point_transactions_select_self on public.point_transactions;
create policy point_transactions_select_self
on public.point_transactions
for select
to authenticated
using (user_id = (select auth.uid()));

-- No INSERT/UPDATE/DELETE for authenticated users directly
-- All writes happen through SECURITY DEFINER functions only
grant select on public.point_transactions to authenticated;

-- 3. Internal helper: idempotent point insert
create or replace function public._insert_point_if_not_exists(
  p_user_id uuid,
  p_meeting_id uuid,
  p_event_type public.point_event_type,
  p_points integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.point_transactions (user_id, meeting_id, event_type, points)
  values (p_user_id, p_meeting_id, p_event_type, p_points)
  on conflict (user_id, meeting_id, event_type) do nothing;
end;
$$;

-- 4. Study cap helper: count points already earned for a user+meeting
create or replace function public._study_points_for_meeting(
  p_user_id uuid,
  p_meeting_id uuid
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(points), 0)::integer
  from public.point_transactions
  where user_id = p_user_id
    and meeting_id = p_meeting_id;
$$;

-- 5. Replace review_meeting_application: add study +1 on approve
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
  v_meeting_type text;
  v_capacity integer;
  v_approved_count integer;
  v_current_study_points integer;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise exception 'INVALID_DECISION' using errcode = '22023';
  end if;

  select a.id, a.meeting_id, a.applicant_id, a.status
  into v_app
  from public.meeting_applications a
  where a.id = p_application_id
  for update;

  if not found then
    raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  select m.created_by, m.meeting_type::text into v_meeting_creator, v_meeting_type
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

      if v_approved_count + 1 >= v_capacity then
        raise exception 'MEETING_CAPACITY_FULL' using errcode = '22023';
      end if;
    end if;

    update public.meeting_applications
    set status = 'approved',
        rejection_reason = null,
        updated_at = now()
    where id = p_application_id;

    -- Study application approved: +1 point (max 3 per member per study enforced by cap)
    if v_meeting_type = 'study' then
      v_current_study_points := public._study_points_for_meeting(v_app.applicant_id, v_app.meeting_id);
      if v_current_study_points < 3 then
        perform public._insert_point_if_not_exists(
          v_app.applicant_id,
          v_app.meeting_id,
          'study_application_approved'::public.point_event_type,
          1
        );
      end if;
    end if;

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

-- 6. Replace set_participant_completion: add completion points
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
  v_current_study_points integer;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select id, status, created_by, meeting_type::text
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

  update public.meeting_applications
  set completed = p_completed,
      completed_at = now(),
      completed_by = v_actor,
      updated_at = now()
  where id = v_app_id;

  -- Issue completion points only when marked completed
  if p_completed = true then
    if v_meeting_type = 'study' then
      -- Study completed: +2 (max 3 total per study including application point)
      v_current_study_points := public._study_points_for_meeting(p_participant_id, p_meeting_id);
      if v_current_study_points + 2 <= 3 then
        perform public._insert_point_if_not_exists(
          p_participant_id,
          p_meeting_id,
          'study_completed'::public.point_event_type,
          2
        );
      elsif v_current_study_points < 3 then
        -- Award only remaining points up to cap of 3
        perform public._insert_point_if_not_exists(
          p_participant_id,
          p_meeting_id,
          'study_completed'::public.point_event_type,
          3 - v_current_study_points
        );
      end if;

    elsif v_meeting_type = 'lecture' then
      perform public._insert_point_if_not_exists(
        p_participant_id,
        p_meeting_id,
        'lecture_completed'::public.point_event_type,
        2
      );

    elsif v_meeting_type = 'lightning' then
      perform public._insert_point_if_not_exists(
        p_participant_id,
        p_meeting_id,
        'lightning_completed'::public.point_event_type,
        1
      );
    end if;
    -- project and regular_networking: no points
  end if;
end;
$$;

-- 7. get_my_point_total: authenticated user reads their own total
create or replace function public.get_my_point_total()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(points), 0)::integer
  from public.point_transactions
  where user_id = (select auth.uid());
$$;

revoke all on function public.get_my_point_total() from public, anon;
grant execute on function public.get_my_point_total() to authenticated;

-- 8. Admin: get associate point totals for promotion eligibility view
create or replace function public.get_associate_point_totals()
returns table (
  user_id uuid,
  total_points integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    public.has_active_role('member_admin')
    or public.is_super_admin()
  ) then
    raise exception 'MEMBER_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  return query
    select
      m.user_id,
      coalesce(sum(pt.points), 0)::integer as total_points
    from public.memberships m
    left join public.point_transactions pt on pt.user_id = m.user_id
    where m.grade = 'associate'
    group by m.user_id;
end;
$$;

revoke all on function public.get_associate_point_totals() from public, anon;
grant execute on function public.get_associate_point_totals() to authenticated;

-- Note: study application cancellation point reversal = deferred policy decision
