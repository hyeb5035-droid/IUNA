import { NextResponse } from 'next/server'
import { getCurrentMemberAuth } from '../../../../lib/supabase/auth'
import { createServerSupabaseClient } from '../../../../lib/supabase/server'

export async function GET() {
  const auth = await getCurrentMemberAuth()

  if (!auth.session?.user) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  const canAccess =
    auth.isSuperAdmin || auth.activeRoles.some((r) => r.code === 'member_admin')

  if (!canAccess) {
    return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403 })
  }

  const supabase = await createServerSupabaseClient()

  // Fetch all members with their profiles and memberships
  const { data, error } = await supabase
    .from('profiles')
    .select(
      `id,
       member_no,
       created_at,
       profile_private!inner ( legal_name ),
       memberships!inner ( grade, status )`,
    )
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[api/admin/members] query error:', error.code, error.message)
    return NextResponse.json({ error: '데이터를 불러오는 중 오류가 발생했습니다.' }, { status: 500 })
  }

  // Fetch active roles with role info
  const { data: roleData } = await supabase
    .from('member_roles')
    .select('user_id, revoked_at, expires_at, roles(code, name, assigned_at)')
    .is('revoked_at', null)

  // Build roles map
  const rolesMap = new Map<string, { code: string; name: string; assigned_at: string }[]>()
  for (const row of (roleData ?? []) as any[]) {
    if (!row.expires_at || new Date(row.expires_at) > new Date()) {
      const roleInfo = Array.isArray(row.roles) ? row.roles[0] : row.roles
      if (roleInfo) {
        const existing = rolesMap.get(row.user_id) || []
        existing.push({
          code: roleInfo.code,
          name: roleInfo.name,
          assigned_at: roleInfo.assigned_at,
        })
        rolesMap.set(row.user_id, existing)
      }
    }
  }

  const operatorUserIds = new Set(
    (roleData ?? [])
      .filter((r: any) => !r.expires_at || new Date(r.expires_at) > new Date())
      .map((r: any) => r.user_id),
  )

  // Fetch associate point totals
  const { data: pointData } = await supabase.rpc('get_associate_point_totals')
  const pointMap = new Map<string, number>()
  for (const row of (pointData ?? [])) {
    pointMap.set(row.user_id, row.total_points)
  }

  const members = (data ?? []).map((row) => {
    const priv = Array.isArray(row.profile_private)
      ? row.profile_private[0]
      : row.profile_private
    const membership = Array.isArray(row.memberships)
      ? row.memberships[0]
      : row.memberships

    return {
      id: row.id,
      member_no: row.member_no,
      legal_name: priv?.legal_name ?? null,
      grade: membership?.grade ?? '',
      status: membership?.status ?? '',
      created_at: row.created_at,
      isOperator: operatorUserIds.has(row.id),
      points: membership?.grade === 'associate' ? (pointMap.get(row.id) ?? 0) : null,
      activeRoles: rolesMap.get(row.id) ?? [],
    }
  })

  return NextResponse.json({ members })
}