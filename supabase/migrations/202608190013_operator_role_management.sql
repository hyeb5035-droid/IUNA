-- IUNA 2.0
-- Migration 013: Operator Role Management
--
-- Implements:
-- - General Operator role (new)
-- - assign_operator_role RPC
-- - revoke_operator_role RPC
-- - Final super-admin protection
--
-- Member number handling reuses existing infrastructure:
-- - allocate_member_number(band)
-- - issue_new_member_number(user_id, band, reason, changed_by)
-- - sync_member_number_for_operator_role(user_id)
-- - trigger sync_member_number_after_role_change

begin;

-- =========================================================
-- 1. ADD GENERAL OPERATOR ROLE
-- =========================================================

insert into public.roles (code, name, description)
values
  ('operator', '일반 운영진', '전체 회원 정보 조회, 운영진 대시보드 접근')
on conflict (code) do nothing;

-- =========================================================
-- 2. ASSIGNMENT RPC
-- =========================================================

create or replace function public.assign_operator_role(
  p_user_id uuid,
  p_role_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_role_id uuid;
  v_target_grade public.member_grade;
  v_target_status public.member_status;
  v_has_existing_role boolean;
  v_count_active_roles integer;
begin
  -- Authorization check
  if v_caller is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if not public.is_super_admin() then
    raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  -- Validate role code - only allow approved roles
  if p_role_code not in ('operator', 'member_admin', 'meeting_admin', 'super_admin') then
    raise exception 'INVALID_ROLE_CODE' using errcode = '22023';
  end if;

  -- Get role_id
  select id into v_role_id
  from public.roles
  where code = p_role_code;

  if not found then
    raise exception 'ROLE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Check target membership - must be active regular member
  select grade, status
  into v_target_grade, v_target_status
  from public.memberships
  where user_id = p_user_id;

  if not found then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_target_grade != 'regular' then
    raise exception 'TARGET_NOT_REGULAR:_regular_grade_required' using errcode = '42501';
  end if;

  if v_target_status != 'active' then
    raise exception 'TARGET_NOT_ACTIVE:active_membership_required' using errcode = '42501';
  end if;

  -- Check for existing active role
  select exists (
    select 1
    from public.member_roles mr
    where mr.user_id = p_user_id
      and mr.role_id = v_role_id
      and mr.revoked_at is null
      and (mr.expires_at is null or mr.expires_at > now())
  )
  into v_has_existing_role;

  if v_has_existing_role then
    raise exception 'DUPLICATE_ROLE_ASSIGNMENT' using errcode = '42501';
  end if;

  -- Count existing active roles
  select count(*)
  into v_count_active_roles
  from public.member_roles mr
  where mr.user_id = p_user_id
    and mr.revoked_at is null
    and (mr.expires_at is null or mr.expires_at > now());

  -- Insert new role assignment
  insert into public.member_roles (
    user_id,
    role_id,
    assigned_by,
    assigned_at
  )
  values (
    p_user_id,
    v_role_id,
    v_caller,
    now()
  );

  -- Log audit
  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    after_data,
    reason
  )
  values (
    v_caller,
    'assign_operator_role',
    'member_roles',
    p_user_id,
    jsonb_build_object('role_code', p_role_code),
    'operator_role_assigned'
  );

  -- Note: member number sync is handled by the existing trigger
  -- sync_member_number_after_role_change which calls sync_member_number_for_operator_role
end;
$$;

revoke all on function public.assign_operator_role(uuid, text)
  from public, anon;
grant execute on function public.assign_operator_role(uuid, text)
  to authenticated;

-- =========================================================
-- 3. REVOCATION RPC
-- =========================================================

create or replace function public.revoke_operator_role(
  p_user_id uuid,
  p_role_code text,
  p_reason text default 'revoked_by_admin'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_role_id uuid;
  v_active_super_admin_count integer;
  v_remaining_active_roles integer;
  v_target_member_no text;
begin
  -- Authorization check
  if v_caller is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if not public.is_super_admin() then
    raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  -- Validate role code
  if p_role_code not in ('operator', 'member_admin', 'meeting_admin', 'super_admin') then
    raise exception 'INVALID_ROLE_CODE' using errcode = '22023';
  end if;

  -- Get role_id
  select id into v_role_id
  from public.roles
  where code = p_role_code;

  if not found then
    raise exception 'ROLE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Special protection: cannot revoke the last super_admin
  if p_role_code = 'super_admin' then
    select count(*)
    into v_active_super_admin_count
    from public.member_roles mr
    join public.roles r on r.id = mr.role_id
    where r.code = 'super_admin'
      and mr.revoked_at is null
      and (mr.expires_at is null or mr.expires_at > now());

    -- Allow revocation only if another super_admin remains
    if v_active_super_admin_count <= 1 then
      raise exception 'CANNOT_REVOKE_LAST_SUPER_ADMIN' using errcode = '42501';
    end if;
  end if;

  -- Get current member number before revocation
  select member_no
  into v_target_member_no
  from public.profiles
  where id = p_user_id;

  -- Revoke the role (update, don't delete)
  update public.member_roles
  set revoked_at = now(),
      revoke_reason = coalesce(p_reason, 'revoked_by_admin')
  where user_id = p_user_id
    and role_id = v_role_id
    and revoked_at is null
    and (expires_at is null or expires_at > now());

  if not found then
    raise exception 'ROLE_ASSIGNMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Check remaining active roles after revocation
  select count(*)
  into v_remaining_active_roles
  from public.member_roles mr
  where mr.user_id = p_user_id
    and mr.revoked_at is null
    and (mr.expires_at is null or mr.expires_at > now());

  -- Log audit
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
    v_caller,
    'revoke_operator_role',
    'member_roles',
    p_user_id,
    jsonb_build_object('role_code', p_role_code, 'member_no', v_target_member_no),
    jsonb_build_object('remaining_roles', v_remaining_active_roles),
    coalesce(p_reason, 'revoked_by_admin')
  );

  -- Note: member number sync is handled by the existing trigger
  -- sync_member_number_after_role_change
end;
$$;

revoke all on function public.revoke_operator_role(uuid, text, text)
  from public, anon;
grant execute on function public.revoke_operator_role(uuid, text, text)
  to authenticated;

-- =========================================================
-- 4. HELPER: GET MEMBER ACTIVE ROLES
-- Returns active role codes for a user
-- =========================================================

create or replace function public.get_member_active_roles(p_user_id uuid)
returns table (
  role_code text,
  role_name text,
  assigned_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.code as role_code,
    r.name as role_name,
    mr.assigned_at
  from public.member_roles mr
  join public.roles r on r.id = mr.role_id
  where mr.user_id = p_user_id
    and mr.revoked_at is null
    and (mr.expires_at is null or mr.expires_at > now())
  order by mr.assigned_at;
$$;

revoke all on function public.get_member_active_roles(uuid) from public, anon;
grant execute on function public.get_member_active_roles(uuid) to authenticated;

-- =========================================================
-- 5. FINAL SUPER-ADMIN CHECK
-- Ensure at least one super_admin always exists
-- =========================================================

create or replace function public.can_revoke_super_admin(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_active_super_admin_count integer;
begin
  select count(*)
  into v_active_super_admin_count
  from public.member_roles mr
  join public.roles r on r.id = mr.role_id
  where r.code = 'super_admin'
    and mr.user_id != p_user_id
    and mr.revoked_at is null
    and (mr.expires_at is null or mr.expires_at > now());

  return v_active_super_admin_count > 0;
end;
$$;

revoke all on function public.can_revoke_super_admin(uuid) from public, anon;
grant execute on function public.can_revoke_super_admin(uuid) to authenticated;

-- =========================================================
-- 6. ENABLE ROLE MANAGEMENT IN ADMIN UI
-- RLS: Only super_admin can manage member_roles
-- =========================================================

drop policy if exists member_roles_manage_super_admin on public.member_roles;
create policy member_roles_manage_super_admin
on public.member_roles
for all
to authenticated
using (
  public.is_super_admin()
);

grant select, insert, update on public.member_roles to authenticated;

commit;