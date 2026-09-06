import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMemberAuth } from '../../../../../lib/supabase/auth'
import { createServerSupabaseClient } from '../../../../../lib/supabase/server'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentMemberAuth()
  if (!auth.session?.user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  if (!auth.isOperator) return NextResponse.json({ error: '운영진 권한이 필요합니다.' }, { status: 403 })

  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('get_operator_member_detail', { p_user_id: id })
  if (error) {
    const notFound = error.message?.includes('MEMBER_NOT_FOUND')
    console.error('[api/admin/members/detail] error:', error.code, error.message)
    return NextResponse.json({ error: notFound ? '회원을 찾을 수 없습니다.' : '회원 정보를 불러오지 못했습니다.' }, { status: notFound ? 404 : 500 })
  }
  return NextResponse.json({ member: data })
}
