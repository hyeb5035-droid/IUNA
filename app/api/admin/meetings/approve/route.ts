import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '../../../../../lib/supabase/server'
import { getCurrentMemberAuth } from '../../../../../lib/supabase/auth'

export async function POST(request: NextRequest) {
  const auth = await getCurrentMemberAuth()

  if (!auth.session?.user) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  // Only meeting_admin or super_admin may review meetings
  const canReview =
    auth.isSuperAdmin || auth.activeRoles.some((r) => r.code === 'meeting_admin')

  if (!canReview) {
    return NextResponse.json({ error: '모임 심사 권한이 없습니다.' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }

  const raw = body as Record<string, unknown>
  const meetingId = typeof raw.meeting_id === 'string' ? raw.meeting_id.trim() : ''
  const decision = typeof raw.decision === 'string' ? raw.decision.trim() : ''
  const assignedOperatorId = typeof raw.assigned_operator_id === 'string' ? raw.assigned_operator_id.trim() : null
  const rejectionReason = typeof raw.rejection_reason === 'string' ? raw.rejection_reason.trim() : null
  const projectPointValue = typeof raw.project_point_value === 'number' ? raw.project_point_value : null

  if (!meetingId || !decision) {
    return NextResponse.json({ error: '필수 정보가 누락되었습니다.' }, { status: 400 })
  }

  if (decision !== 'approve' && decision !== 'reject') {
    return NextResponse.json({ error: '잘못된 결정입니다.' }, { status: 400 })
  }

  if (decision === 'approve' && !assignedOperatorId) {
    return NextResponse.json({ error: '담당 운영진을 선택해주세요.' }, { status: 400 })
  }

  if (decision === 'reject' && !rejectionReason) {
    return NextResponse.json({ error: '반려 사유를 입력해주세요.' }, { status: 400 })
  }

  const supabase = await createServerSupabaseClient()

  const { error } = await supabase.rpc('review_meeting', {
    p_meeting_id: meetingId,
    p_decision: decision,
    p_assigned_operator_id: assignedOperatorId,
    p_rejection_reason: rejectionReason,
    p_project_point_value: projectPointValue,
  })

  if (error) {
    console.error('[admin/meetings/approve] RPC error:', error.code, error.message)

    const msg = error.message ?? ''
    let userMessage = '심사 처리 중 오류가 발생했습니다.'

    if (msg.includes('MEETING_ADMIN_REQUIRED')) userMessage = '모임 심사 권한이 없습니다.'
    else if (msg.includes('MEETING_NOT_FOUND')) userMessage = '모임을 찾을 수 없습니다.'
    else if (msg.includes('NOT_PENDING_APPROVAL')) userMessage = '승인대기 상태의 모임만 심사할 수 있습니다.'
    else if (msg.includes('ASSIGNED_OPERATOR_REQUIRED')) userMessage = '담당 운영진을 선택해주세요.'
    else if (msg.includes('ASSIGNED_USER_NOT_OPERATOR')) userMessage = '선택한 사용자가 운영진이 아닙니다.'
    else if (msg.includes('REJECTION_REASON_REQUIRED')) userMessage = '반려 사유를 입력해주세요.'
    else if (msg.includes('PROJECT_POINT_VALUE_REQUIRED')) userMessage = '프로젝트 포인트를 선택해주세요 (3, 4, 5).'

    return NextResponse.json({ error: userMessage }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
