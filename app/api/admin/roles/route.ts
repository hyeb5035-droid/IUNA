import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMemberAuth } from '../../../../lib/supabase/auth'
import { createServerSupabaseClient } from '../../../../lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()

  const { data: sessionData } = await supabase.auth.getSession()
  const user = sessionData?.session?.user ?? null

  if (!user) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  // Check super_admin permission
  const auth = await getCurrentMemberAuth()
  if (!auth.isSuperAdmin) {
    return NextResponse.json({ error: '슈퍼 관리자 권한이 필요합니다.' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }

  const raw = body as Record<string, unknown>
  const action = typeof raw.action === 'string' ? raw.action : ''
  const targetUserId = typeof raw.user_id === 'string' ? raw.user_id.trim() : ''
  const roleCode = typeof raw.role_code === 'string' ? raw.role_code.trim() : ''
  const allowedRoles = new Set(['operator', 'member_admin', 'meeting_admin', 'super_admin'])

  if (!action || !targetUserId || !roleCode) {
    return NextResponse.json({ error: '필수 파라미터가 누락되었습니다.' }, { status: 400 })
  }

  if (!allowedRoles.has(roleCode)) {
    return NextResponse.json({ error: '유효하지 않은 역할 코드입니다.' }, { status: 400 })
  }

  if (action === 'assign') {
    const { error } = await supabase.rpc('assign_operator_role', {
      p_user_id: targetUserId,
      p_role_code: roleCode,
    })

    if (error) {
      console.error('[api/admin/roles] assign error:', error.code, error.message)
      const code = error.message ?? ''
      let userMessage = '운영진 지정 중 오류가 발생했습니다.'

      if (code.includes('SUPER_ADMIN_REQUIRED')) {
        userMessage = '슈퍼 관리자 권한이 필요합니다.'
      } else if (code.includes('TARGET_NOT_REGULAR')) {
        userMessage = '대상 회원은 정회원이어야 합니다.'
      } else if (code.includes('TARGET_NOT_ACTIVE')) {
        userMessage = '대상 회원은 활동 회원이어야 합니다.'
      } else if (code.includes('DUPLICATE_ROLE_ASSIGNMENT')) {
        userMessage = '이미 부여된 역할입니다.'
      } else if (code.includes('INVALID_ROLE_CODE')) {
        userMessage = '유효하지 않은 역할 코드입니다.'
      }

      return NextResponse.json({ error: userMessage }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  }

  if (action === 'revoke') {
    const { error } = await supabase.rpc('revoke_operator_role', {
      p_user_id: targetUserId,
      p_role_code: roleCode,
      p_reason: 'admin_revoked',
    })

    if (error) {
      console.error('[api/admin/roles] revoke error:', error.code, error.message)
      const code = error.message ?? ''
      let userMessage = '권한 해제 중 오류가 발생했습니다.'

      if (code.includes('SUPER_ADMIN_REQUIRED')) {
        userMessage = '슈퍼 관리자 권한이 필요합니다.'
      } else if (code.includes('CANNOT_REVOKE_LAST_SUPER_ADMIN')) {
        userMessage = '마지막 슈퍼 관리자는 해제할 수 없습니다.'
      } else if (code.includes('ROLE_ASSIGNMENT_NOT_FOUND')) {
        userMessage = '활성 역할이 존재하지 않습니다.'
      }

      return NextResponse.json({ error: userMessage }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: '유효하지 않은 작업입니다.' }, { status: 400 })
}
