import { NextResponse } from 'next/server'
import { getCurrentMemberAuth } from '../../../../lib/supabase/auth'
import { createServerSupabaseClient } from '../../../../lib/supabase/server'

function mapDirectoryRows(rows: any[] | null) {
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

export async function GET() {
  const auth = await getCurrentMemberAuth()
  if (!auth.session?.user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  if (!auth.isOperator) return NextResponse.json({ error: '운영진 권한이 필요합니다.' }, { status: 403 })

  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('get_operator_member_directory')
  if (error) {
    console.error('[api/admin/members] directory error:', error.code, error.message)
    return NextResponse.json({ error: '회원 목록을 불러오지 못했습니다.' }, { status: 500 })
  }
  return NextResponse.json({ members: mapDirectoryRows(data) })
}
