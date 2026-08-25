-- =========================================================
-- Meeting Creator Public Profile RPCs
-- Batch RPC for list + single RPC for detail
-- =========================================================

-- 1. Batch: get creator display info for multiple meetings (list page)
create or replace function public.get_meeting_creator_summaries(p_meeting_ids uuid[])
returns table (
  meeting_id uuid,
  legal_name text,
  profile_image_path text
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

  return query
    select
      m.id as meeting_id,
      pp.legal_name,
      p.profile_image_path
    from public.meetings m
    join public.profiles p on p.id = m.created_by
    left join public.profile_private pp on pp.user_id = m.created_by
    where m.id = any(p_meeting_ids)
      and m.deleted_at is null;
end;
$$;

revoke all on function public.get_meeting_creator_summaries(uuid[]) from public, anon;
grant execute on function public.get_meeting_creator_summaries(uuid[]) to authenticated;

-- 2. Single: get full creator public profile for meeting detail
create or replace function public.get_meeting_creator_public_profile(p_meeting_id uuid)
returns table (
  legal_name text,
  profile_image_path text,
  company_name text,
  job_title text,
  introduction text,
  interests text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_creator_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select m.created_by into v_creator_id
  from public.meetings m
  where m.id = p_meeting_id and m.deleted_at is null;

  if not found then
    raise exception 'MEETING_NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
    select
      pp.legal_name,
      p.profile_image_path,
      p.company_name,
      p.job_title,
      p.introduction,
      p.interests
    from public.profiles p
    left join public.profile_private pp on pp.user_id = p.id
    where p.id = v_creator_id;
end;
$$;

revoke all on function public.get_meeting_creator_public_profile(uuid) from public, anon;
grant execute on function public.get_meeting_creator_public_profile(uuid) to authenticated;
