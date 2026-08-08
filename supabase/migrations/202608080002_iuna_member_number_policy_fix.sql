-- IUNA 2.0
-- Migration 002: member number policy correction
--
-- Confirmed policy:
--   - 운영진: 10000번대 (10000-19999)
--   - 정회원: 20000번대 (20000-29999)
--   - 준회원: 90000번대 (90000-99999)
--   - 신규 가입자는 준회원 번호 자동 발급
--   - 승급/강등 시 새로운 번호 발급
--   - 운영진 권한 진입/해제 시 현재 신분에 맞는 새 번호 발급
--   - 한 번 발급된 번호는 재사용하지 않음
--   - 모든 회원번호 변경 이력 보존
--
-- 명예회원 번호 대역은 확정 정책이 없으므로 자동 처리하지 않는다.
-- 명예회원이 이미 존재하면 migration을 중단하여 임의 정책 적용을 방지한다.

begin;

-- =========================================================
-- 1. PRE-FLIGHT: HONORARY MEMBER POLICY IS NOT YET DEFINED
-- =========================================================

do $$
begin
  if exists (
    select 1
    from public.memberships
    where grade = 'honorary'::public.member_grade
  ) then
    raise exception
      'HONORARY_MEMBER_NUMBER_POLICY_REQUIRED: 명예회원 회원번호 대역 정책을 먼저 확정해야 합니다.';
  end if;
end
$$;

-- =========================================================
-- 2. MEMBER NUMBER SEQUENCES
-- Never cycle: issued numbers are never reused.
-- =========================================================

create sequence if not exists public.member_no_operator_seq
  as integer
  start with 10000
  increment by 1
  minvalue 10000
  maxvalue 19999
  no cycle;

create sequence if not exists public.member_no_regular_seq
  as integer
  start with 20000
  increment by 1
  minvalue 20000
  maxvalue 29999
  no cycle;

create sequence if not exists public.member_no_associate_seq
  as integer
  start with 90000
  increment by 1
  minvalue 90000
  maxvalue 99999
  no cycle;

revoke all on sequence public.member_no_operator_seq from public, anon, authenticated;
revoke all on sequence public.member_no_regular_seq from public, anon, authenticated;
revoke all on sequence public.member_no_associate_seq from public, anon, authenticated;

-- =========================================================
-- 3. MEMBER NUMBER HISTORY
-- =========================================================

create table if not exists public.member_number_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  member_no text not null,
  number_band text not null
    check (number_band in ('operator', 'regular', 'associate')),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  change_reason text not null,
  changed_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),

  constraint member_number_history_number_format
    check (member_no ~ '^[0-9]{5}$'),
  constraint member_number_history_validity
    check (valid_to is null or valid_to >= valid_from),
  constraint member_number_history_number_never_reused
    unique (member_no)
);

create unique index if not exists uq_member_number_history_one_current_per_user
  on public.member_number_history(user_id)
  where valid_to is null;

create index if not exists idx_member_number_history_user_date
  on public.member_number_history(user_id, valid_from desc);

alter table public.member_number_history enable row level security;

drop policy if exists member_number_history_select_self_admin
  on public.member_number_history;

create policy member_number_history_select_self_admin
on public.member_number_history
for select
to authenticated
using (
  user_id = (select auth.uid())
  or public.has_active_role('member_admin')
  or public.is_super_admin()
);

grant select on public.member_number_history to authenticated;

-- =========================================================
-- 4. ALLOCATION HELPERS
-- =========================================================

create or replace function public.allocate_member_number(p_band text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number integer;
begin
  case p_band
    when 'operator' then
      v_number := nextval('public.member_no_operator_seq');
    when 'regular' then
      v_number := nextval('public.member_no_regular_seq');
    when 'associate' then
      v_number := nextval('public.member_no_associate_seq');
    else
      raise exception 'INVALID_MEMBER_NUMBER_BAND: %', p_band
        using errcode = '22023';
  end case;

  return lpad(v_number::text, 5, '0');
exception
  when sequence_generator_limit_exceeded then
    raise exception 'MEMBER_NUMBER_RANGE_EXHAUSTED: %', p_band
      using errcode = '54000';
end;
$$;

revoke all on function public.allocate_member_number(text)
  from public, anon, authenticated;

-- Keep the original function name used by profiles.member_no DEFAULT,
-- but correct its behavior to issue a 90000-range associate number.
create or replace function public.generate_member_no()
returns text
language sql
security definer
set search_path = ''
as $$
  select public.allocate_member_number('associate');
$$;

revoke all on function public.generate_member_no()
  from public, anon, authenticated;

alter table public.profiles
  alter column member_no set default public.generate_member_no();

-- =========================================================
-- 5. INTERNAL NUMBER-CHANGE FUNCTION
-- Closes previous history + changes current number + opens new history.
-- =========================================================

create or replace function public.issue_new_member_number(
  p_user_id uuid,
  p_band text,
  p_reason text,
  p_changed_by uuid default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_no text;
begin
  if p_band not in ('operator', 'regular', 'associate') then
    raise exception 'INVALID_MEMBER_NUMBER_BAND: %', p_band
      using errcode = '22023';
  end if;

  perform 1
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'MEMBER_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  v_new_no := public.allocate_member_number(p_band);

  update public.member_number_history
  set valid_to = now()
  where user_id = p_user_id
    and valid_to is null;

  update public.profiles
  set member_no = v_new_no,
      updated_at = now()
  where id = p_user_id;

  insert into public.member_number_history (
    user_id,
    member_no,
    number_band,
    valid_from,
    change_reason,
    changed_by
  )
  values (
    p_user_id,
    v_new_no,
    p_band,
    now(),
    p_reason,
    p_changed_by
  );

  return v_new_no;
end;
$$;

revoke all on function public.issue_new_member_number(uuid, text, text, uuid)
  from public, anon, authenticated;

-- =========================================================
-- 6. MIGRATE EXISTING MEMBERS FROM OLD IUNA-YYYY-XXXXX FORMAT
-- =========================================================

do $$
declare
  r record;
  v_band text;
begin
  for r in
    select
      p.id as user_id,
      m.grade,
      exists (
        select 1
        from public.member_roles mr
        where mr.user_id = p.id
          and mr.revoked_at is null
          and (mr.expires_at is null or mr.expires_at > now())
      ) as is_operator
    from public.profiles p
    join public.memberships m on m.user_id = p.id
    order by p.created_at asc, p.id asc
  loop
    if r.is_operator then
      v_band := 'operator';
    elsif r.grade = 'regular'::public.member_grade then
      v_band := 'regular';
    elsif r.grade = 'associate'::public.member_grade then
      v_band := 'associate';
    else
      raise exception
        'HONORARY_MEMBER_NUMBER_POLICY_REQUIRED for user %',
        r.user_id;
    end if;

    perform public.issue_new_member_number(
      r.user_id,
      v_band,
      'migration_002_member_number_policy_fix',
      null
    );
  end loop;
end
$$;

-- After all existing rows are converted, enforce the new five-digit format.
alter table public.profiles
  drop constraint if exists profiles_member_no_format;

alter table public.profiles
  add constraint profiles_member_no_format
  check (member_no ~ '^[0-9]{5}$');

-- Old sequence remains only for migration-history compatibility.
-- It is no longer used by profiles/member-number functions.
revoke all on sequence public.member_number_seq from public, anon, authenticated;

-- =========================================================
-- 7. NEW USER BOOTSTRAP
-- New members receive 90000-range number + initial number history.
-- =========================================================

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_no text;
begin
  insert into public.profiles (id, nickname)
  values (
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'nickname', '')), '')
  )
  returning member_no into v_member_no;

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

  insert into public.member_number_history (
    user_id,
    member_no,
    number_band,
    change_reason,
    changed_by
  )
  values (
    new.id,
    v_member_no,
    'associate',
    'signup',
    null
  );

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

revoke all on function public.handle_new_auth_user()
  from public, anon, authenticated;

-- =========================================================
-- 8. GRADE CHANGE RPC
-- Promotion/demotion always issues a fresh number.
-- If user is currently an operator, the fresh number stays in 10000 range.
-- Honorary grade is intentionally blocked until its member-number policy is defined.
-- =========================================================

alter type public.history_reason_code
  add value if not exists 'demotion';

create or replace function public.change_member_grade(
  p_user_id uuid,
  p_to_grade public.member_grade,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_from public.member_grade;
  v_band text;
  v_new_no text;
  v_is_operator boolean;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED'
      using errcode = '42501';
  end if;

  if not (
    public.has_active_role('member_admin')
    or public.is_super_admin()
  ) then
    raise exception 'MEMBER_ADMIN_REQUIRED'
      using errcode = '42501';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'REASON_REQUIRED'
      using errcode = '22023';
  end if;

  if p_to_grade = 'honorary'::public.member_grade then
    raise exception 'HONORARY_MEMBER_NUMBER_POLICY_REQUIRED'
      using errcode = '0A000';
  end if;

  select grade
  into v_from
  from public.memberships
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'MEMBER_NOT_FOUND'
      using errcode = 'P0002';
  end if;

  if v_from = p_to_grade then
    raise exception 'GRADE_NOT_CHANGED'
      using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.member_roles mr
    where mr.user_id = p_user_id
      and mr.revoked_at is null
      and (mr.expires_at is null or mr.expires_at > now())
  )
  into v_is_operator;

  if v_is_operator then
    v_band := 'operator';
  elsif p_to_grade = 'regular'::public.member_grade then
    v_band := 'regular';
  else
    v_band := 'associate';
  end if;

  update public.memberships
  set grade = p_to_grade,
      grade_started_at = now(),
      updated_at = now()
  where user_id = p_user_id;

  insert into public.member_grade_history (
    user_id,
    from_grade,
    to_grade,
    reason_code,
    reason_text,
    changed_by
  )
  values (
    p_user_id,
    v_from,
    p_to_grade,
    case
      when v_from = 'associate'::public.member_grade
       and p_to_grade = 'regular'::public.member_grade
        then 'promotion'::public.history_reason_code
      else 'demotion'::public.history_reason_code
    end,
    p_reason,
    v_actor
  );

  v_new_no := public.issue_new_member_number(
    p_user_id,
    v_band,
    case
      when v_from = 'associate'::public.member_grade
       and p_to_grade = 'regular'::public.member_grade
        then 'grade_promotion'
      else 'grade_demotion'
    end,
    v_actor
  );

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    reason
  )
  values (
    v_actor,
    'change_member_grade',
    'membership',
    p_user_id,
    jsonb_build_object(
      'grade', v_from,
      'member_no', (
        select h.member_no
        from public.member_number_history h
        where h.user_id = p_user_id
          and h.valid_to is not null
        order by h.valid_to desc
        limit 1
      )
    ),
    jsonb_build_object(
      'grade', p_to_grade,
      'member_no', v_new_no
    ),
    p_reason
  );

  return v_new_no;
end;
$$;

revoke all on function public.change_member_grade(uuid, public.member_grade, text)
  from public, anon;
grant execute on function public.change_member_grade(uuid, public.member_grade, text)
  to authenticated;

-- =========================================================
-- 9. OPERATOR ROLE -> MEMBER NUMBER SYNC
-- Any active operator/admin role means 10000-range current number.
-- When the final active role is revoked, issue a fresh number for current grade.
-- =========================================================

create or replace function public.current_member_number_band(p_member_no text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_member_no ~ '^1[0-9]{4}$' then 'operator'
    when p_member_no ~ '^2[0-9]{4}$' then 'regular'
    when p_member_no ~ '^9[0-9]{4}$' then 'associate'
    else null
  end;
$$;

create or replace function public.sync_member_number_for_operator_role(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_operator boolean;
  v_grade public.member_grade;
  v_current_no text;
  v_current_band text;
  v_target_band text;
  v_actor uuid := (select auth.uid());
begin
  select
    m.grade,
    p.member_no
  into
    v_grade,
    v_current_no
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  where m.user_id = p_user_id
  for update of m, p;

  if not found then
    return;
  end if;

  select exists (
    select 1
    from public.member_roles mr
    where mr.user_id = p_user_id
      and mr.revoked_at is null
      and (mr.expires_at is null or mr.expires_at > now())
  )
  into v_is_operator;

  v_current_band := public.current_member_number_band(v_current_no);

  if v_is_operator then
    v_target_band := 'operator';
  elsif v_grade = 'regular'::public.member_grade then
    v_target_band := 'regular';
  elsif v_grade = 'associate'::public.member_grade then
    v_target_band := 'associate';
  else
    raise exception 'HONORARY_MEMBER_NUMBER_POLICY_REQUIRED'
      using errcode = '0A000';
  end if;

  -- Only role-band transitions create a new number.
  if v_current_band is distinct from v_target_band then
    perform public.issue_new_member_number(
      p_user_id,
      v_target_band,
      case
        when v_target_band = 'operator'
          then 'operator_role_assigned'
        else 'operator_role_revoked'
      end,
      v_actor
    );
  end if;
end;
$$;

revoke all on function public.sync_member_number_for_operator_role(uuid)
  from public, anon, authenticated;

create or replace function public.trg_sync_member_number_for_operator_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_member_number_for_operator_role(old.user_id);
    return old;
  end if;

  perform public.sync_member_number_for_operator_role(new.user_id);

  if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id then
    perform public.sync_member_number_for_operator_role(old.user_id);
  end if;

  return new;
end;
$$;

revoke all on function public.trg_sync_member_number_for_operator_role()
  from public, anon, authenticated;

drop trigger if exists sync_member_number_after_role_change
  on public.member_roles;

create trigger sync_member_number_after_role_change
after insert or update or delete
on public.member_roles
for each row
execute function public.trg_sync_member_number_for_operator_role();

-- =========================================================
-- 10. FINAL CONSISTENCY CHECKS
-- =========================================================

do $$
begin
  if exists (
    select 1
    from public.profiles p
    join public.memberships m on m.user_id = p.id
    where
      (
        exists (
          select 1
          from public.member_roles mr
          where mr.user_id = p.id
            and mr.revoked_at is null
            and (mr.expires_at is null or mr.expires_at > now())
        )
        and p.member_no !~ '^1[0-9]{4}$'
      )
      or
      (
        not exists (
          select 1
          from public.member_roles mr
          where mr.user_id = p.id
            and mr.revoked_at is null
            and (mr.expires_at is null or mr.expires_at > now())
        )
        and m.grade = 'regular'::public.member_grade
        and p.member_no !~ '^2[0-9]{4}$'
      )
      or
      (
        not exists (
          select 1
          from public.member_roles mr
          where mr.user_id = p.id
            and mr.revoked_at is null
            and (mr.expires_at is null or mr.expires_at > now())
        )
        and m.grade = 'associate'::public.member_grade
        and p.member_no !~ '^9[0-9]{4}$'
      )
  ) then
    raise exception 'MEMBER_NUMBER_POLICY_CONSISTENCY_CHECK_FAILED';
  end if;
end
$$;

commit;
