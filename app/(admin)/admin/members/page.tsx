import { redirect } from 'next/navigation'
import { getCurrentMemberAuth } from '../../../../lib/supabase/auth'
import { createServerSupabaseClient } from '../../../../lib/supabase/server'
import MemberListClient from './MemberListClient'

export const dynamic = 'force-dynamic'

export type ActiveRole = { code: string; name: string; assigned_at: string }
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

export function mapDirectoryRows(rows: any[] | null): MemberRow[] {
  return (rows ?? []).map((row) => ({
    id: row.user_id,
    member_no: row.member_no,
    legal_name: row.legal_name ?? null,
    grade: row.grade,
    status: row.status,
    created_at: row.joined_at,
    isOperator: Array.isArray(row.active_roles) && row.active_roles.length > 0,
    points: row.grade === 'associate' ? Number(row.total_points ?? 0) : null,
    activeRoles: Array.isArray(row.active_roles) ? row.active_roles : [],
  }))
}

export default async function AdminMembersPage() {
  const auth = await getCurrentMemberAuth()
  if (!auth.session?.user) redirect('/login')
  if (!auth.isOperator) redirect('/my')

  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('get_operator_member_directory')
  if (error) console.error('[admin/members] directory error:', error.code, error.message)
  const members = mapDirectoryRows(data)

  return (
    <main className="min-h-screen bg-[#F7F6F2] px-4 py-8 text-[#111111] sm:px-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold">회원 관리</h1>
          <p className="mt-0.5 text-xs text-slate-500">총 {members.length}명</p>
        </div>
        {error ? (
          <div className="rounded-2xl border border-red-200 bg-white p-6 text-sm text-red-600">회원 목록을 불러오지 못했습니다.</div>
        ) : (
          <MemberListClient members={members} canManageMembers={auth.isSuperAdmin || auth.activeRoles.some((role) => role.code === 'member_admin')} isSuperAdmin={auth.isSuperAdmin} />
        )}
      </div>
    </main>
  )
}
