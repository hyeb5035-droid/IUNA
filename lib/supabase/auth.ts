import { createBrowserSupabaseClient } from './client'
import { createServerSupabaseClient } from './server'
import type { Session, SupabaseClient, User } from '@supabase/supabase-js'

export type MemberGrade = 'associate' | 'regular' | 'honorary'
export type MemberStatus = 'active' | 'dormant' | 'withdrawn' | 'expelled'

export type MemberProfile = {
  id: string
  member_no: string
  nickname: string | null
  profile_image_path: string | null
  company_name: string | null
  job_title: string | null
  introduction: string | null
  interests: string[]
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type Membership = {
  user_id: string
  grade: MemberGrade
  status: MemberStatus
  grade_started_at: string
  status_started_at: string
  last_completed_activity_at: string | null
  dormant_at: string | null
  withdrawn_at: string | null
  expelled_at: string | null
  updated_at: string
}

export type MemberRole = {
  id: string
  assigned_at: string | null
  expires_at: string | null
  revoked_at: string | null
  role: {
    code: string
    name: string
  } | null
}

export type CurrentMemberAuth = {
  session: Session | null
  user: User | null
  profile: MemberProfile | null
  membership: Membership | null
  activeRoles: Array<{ code: string; name: string }>
  isOperator: boolean
  isSuperAdmin: boolean
  memberNumberBand: 'operator' | 'regular' | 'associate' | null
}

function resolveMemberNumberBand(memberNo?: string | null) {
  if (!memberNo) {
    return null
  }

  if (/^1[0-9]{4}$/.test(memberNo)) {
    return 'operator'
  }
  if (/^2[0-9]{4}$/.test(memberNo)) {
    return 'regular'
  }
  if (/^9[0-9]{4}$/.test(memberNo)) {
    return 'associate'
  }

  return null
}

export async function getCurrentSupabaseSession() {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.auth.getSession()
  return data.session
}

export async function getCurrentMemberAuth(): Promise<CurrentMemberAuth> {
  const supabase = await createServerSupabaseClient()
  const { data: sessionData } = await supabase.auth.getSession()
  const session = sessionData.session ?? null
  const user = session?.user ?? null

  if (!user) {
    return {
      session: null,
      user: null,
      profile: null,
      membership: null,
      activeRoles: [],
      isOperator: false,
      isSuperAdmin: false,
      memberNumberBand: null,
    }
  }

  const [profileResponse, membershipResponse, roleResponse] = await Promise.all([
    supabase.from('profiles').select(
      'id, member_no, nickname, profile_image_path, company_name, job_title, introduction, interests, created_at, updated_at, deleted_at',
    ).eq('id', user.id).single(),
    supabase.from('memberships').select(
      'user_id, grade, status, grade_started_at, status_started_at, last_completed_activity_at, dormant_at, withdrawn_at, expelled_at, updated_at',
    ).eq('user_id', user.id).single(),
    supabase.from('member_roles').select(
      'id, assigned_at, expires_at, revoked_at, roles(code, name)',
    ).eq('user_id', user.id),
  ])

  const profile = profileResponse.data ?? null
  const membership = membershipResponse.data ?? null
  const roles = Array.isArray(roleResponse.data) ? roleResponse.data : []

  if (roleResponse.error) {
    console.error('[getCurrentMemberAuth] member_roles query error:', roleResponse.error.code)
  }

  const activeRoles = roles
    .filter((role) => role && role.revoked_at === null)
    .filter((role) => !role.expires_at || new Date(role.expires_at) > new Date())
    .map((role) => {
      const roleData = Array.isArray(role.roles) ? role.roles[0] : role.roles
      return {
        code: roleData?.code ?? '',
        name: roleData?.name ?? '',
      }
    })
    .filter((role) => role.code)

  const isSuperAdmin = activeRoles.some((role) => role.code === 'super_admin')
  const isOperator = activeRoles.length > 0
  const memberNumberBand = resolveMemberNumberBand(profile?.member_no)

  return {
    session,
    user,
    profile,
    membership,
    activeRoles,
    isOperator,
    isSuperAdmin,
    memberNumberBand,
  }
}

export async function finalizeSignupProfile(
  supabase: SupabaseClient,
  user: User,
): Promise<{ updated: boolean; error: any | null }> {
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>
  const companyName = typeof metadata.company_name === 'string' ? metadata.company_name.trim() : ''
  const jobTitle = typeof metadata.job_title === 'string' ? metadata.job_title.trim() : ''
  const introduction = typeof metadata.introduction === 'string' ? metadata.introduction.trim() : ''
  const rawInterests = metadata.interests
  const interests = Array.isArray(rawInterests)
    ? rawInterests.map((item) => String(item).trim()).filter(Boolean)
    : typeof rawInterests === 'string'
    ? rawInterests.split(',').map((item) => item.trim()).filter(Boolean)
    : []

  if (!companyName && !jobTitle && !introduction && interests.length === 0) {
    return { updated: false, error: null }
  }

  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .select('company_name, job_title, introduction, interests')
    .eq('id', user.id)
    .single()

  if (profileError || !profileData) {
    return { updated: false, error: profileError ?? new Error('profile_not_found') }
  }

  const updatePayload: Record<string, unknown> = {}
  if (!profileData.company_name && companyName) updatePayload.company_name = companyName
  if (!profileData.job_title && jobTitle) updatePayload.job_title = jobTitle
  if (!profileData.introduction && introduction) updatePayload.introduction = introduction
  if (
    (!profileData.interests || (Array.isArray(profileData.interests) && profileData.interests.length === 0)) &&
    interests.length > 0
  ) {
    updatePayload.interests = interests
  }

  if (Object.keys(updatePayload).length === 0) {
    console.log('[finalizeSignupProfile] updatePayload is empty — nothing to update')
    return { updated: false, error: null }
  }

  console.log('[finalizeSignupProfile] updating with keys:', Object.keys(updatePayload))
  const { error: updateError } = await supabase
    .from('profiles')
    .update(updatePayload)
    .eq('id', user.id)

  console.log('[finalizeSignupProfile] update result error:', updateError?.code, updateError?.message)

  if (updateError) {
    return { updated: false, error: updateError }
  }

  return { updated: true, error: null }
}
