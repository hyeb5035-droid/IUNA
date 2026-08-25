-- =========================================================
-- RPC: get_meeting_manager_candidates
-- Returns all active operators for 담당 운영진 assignment.
-- Callable only by meeting_admin or super_admin.
-- =========================================================

create or replace function public.get_meeting_manager_candidates()
returns table (
  user_id uuid,
  member_no text,
  legal_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Authorization: only meeting_admin or super_admin
  if not (
    public.has_active_role('meeting_admin')
    or public.is_super_admin()
  ) then
    raise exception 'MEETING_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  return query
    select distinct on (mr.user_id)
      mr.user_id,
      p.member_no,
      pp.legal_name
    from public.member_roles mr
    join public.profiles p on p.id = mr.user_id
    left join public.profile_private pp on pp.user_id = mr.user_id
    where mr.revoked_at is null
      and (mr.expires_at is null or mr.expires_at > now())
      and p.deleted_at is null
    order by mr.user_id, p.member_no;
end;
$$;

revoke all on function public.get_meeting_manager_candidates() from public, anon;
grant execute on function public.get_meeting_manager_candidates() to authenticated;
