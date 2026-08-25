import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '../../../../lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()

  const { data: sessionData } = await supabase.auth.getSession()
  const user = sessionData?.session?.user ?? null

  if (!user) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }

  const raw = body as Record<string, unknown>
  const targetUserId = typeof raw.user_id === 'string' ? raw.user_id.trim() : ''
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : ''

  if (!targetUserId) {
    return NextResponse.json({ error: '대상 회원 정보가 필요합니다.' }, { status: 400 })
  }

  if (!reason) {
    return NextResponse.json({ error: '승급 사유를 입력해주세요.' }, { status: 400 })
  }

  // Call the DB function — it handles authorization, grade change,
  // member number issuance, history, and audit atomically.
  // TODO: 승급 가능 조건(5점 이상)은 포인트 기능 구현 시 연결
  const { data, error } = await supabase.rpc('change_member_grade', {
    p_user_id: targetUserId,
    p_to_grade: 'regular',
    p_reason: reason,
  })

  if (error) {
    console.error('[admin/promote] RPC error:', error.code, error.message)

    const code = error.message ?? ''
    let userMessage = '승급 처리 중 오류가 발생했습니다.'

    if (code.includes('MEMBER_ADMIN_REQUIRED')) {
      userMessage = '승급 권한이 없습니다.'
    } else if (code.includes('GRADE_NOT_CHANGED')) {
      userMessage = '이미 정회원입니다.'
    } else if (code.includes('MEMBER_NOT_FOUND')) {
      userMessage = '회원 정보를 찾을 수 없습니다.'
    } else if (code.includes('HONORARY_MEMBER_NUMBER_POLICY_REQUIRED')) {
      userMessage = '명예회원은 이 방법으로 승급할 수 없습니다.'
    } else if (code.includes('REASON_REQUIRED')) {
      userMessage = '승급 사유를 입력해주세요.'
    }

    return NextResponse.json({ error: userMessage }, { status: 400 })
  }

  // data is the new member number (text) returned by the function
  return NextResponse.json({ ok: true, new_member_no: data })
}
