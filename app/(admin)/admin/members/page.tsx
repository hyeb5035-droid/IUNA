import { redirect } from 'next/navigation'
import { getCurrentMemberAuth } from '../../../../lib/supabase/auth'
import { createServerSupabaseClient } from '../../../../lib/supabase/server'
import MemberListClient from './MemberListClient'

export const dynamic = 'force-dynamic'

export type ActiveRole = {
  code: string
  name: string
  assigned_at: string
}

export type MemberRow = {
  id: string
  member_no: string
  legal_name: string | null
  grade: string
  status: string
  created_at: string
  isOperator: boolean
  points: number | null
  activeRoles: ActiveRole[]
}

export default async function AdminMembersPage() {
  const auth = await getCurrentMemberAuth()

  if (!auth.session?.user) {
    redirect('/login')
  }

  const canAccess =
    auth.isSuperAdmin || auth.activeRoles.some((r) => r.code === 'member_admin')

  if (!canAccess) {
    redirect('/my')
  }

  const supabase = await createServerSupabaseClient()

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

  // Fetch operator roles with role info
  const { data: roleData } = await supabase
    .from('member_roles')
    .select('user_id, revoked_at, expires_at, roles(code, name, assigned_at)')
    .is('revoked_at', null)

  // Build roles map
  const rolesMap = new Map<string, ActiveRole[]>()
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

  if (error) {
    console.error('[admin/members] query error:', error.code, error.message)
    return (
      <main className="min-h-screen bg-[#F7F6F2] px-4 py-8 text-[#111111] sm:px-6">
        <div className="mx-auto max-w-4xl rounded-2xl border border-[#E5E1DA] bg-white p-6">
          <h1 className="text-xl font-semibold">회원 관리</h1>
          <p className="mt-3 text-red-500 text-sm">데이터를 불러오는 중 오류가 발생했습니다.</p>
        </div>
      </main>
    )
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

  const members: MemberRow[] = (data ?? []).map((row) => {
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

  return (
    <main className="min-h-screen bg-[#F7F6F2] px-4 py-8 text-[#111111] sm:px-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">회원 관리</h1>
            <p className="text-xs text-slate-500 mt-0.5">총 {members.length}명</p>
          </div>
        </div>
        <MemberListClient members={members} />
      </div>
    </main>
  )
}
