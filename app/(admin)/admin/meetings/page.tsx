import { redirect } from 'next/navigation'
import { getCurrentMemberAuth } from '../../../../lib/supabase/auth'
import { createServerSupabaseClient } from '../../../../lib/supabase/server'
import MeetingApprovalClient from './MeetingApprovalClient'
import PaymentConfirmationClient, { type PendingPayment } from './PaymentConfirmationClient'

export const dynamic = 'force-dynamic'

export type PendingMeeting = {
  id: string
  meeting_type: string | null
  title: string
  created_at: string
  status: string
}

export type OperatorOption = {
  id: string
  member_no: string
  legal_name: string | null
}

export default async function AdminMeetingsPage() {
  const auth = await getCurrentMemberAuth()

  if (!auth.session?.user) {
    redirect('/login')
  }

  const canReview =
    auth.isSuperAdmin || auth.activeRoles.some((r) => r.code === 'meeting_admin')

  if (!canReview) {
    redirect('/my')
  }

  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('meetings')
    .select('id, meeting_type, title, created_at, status')
    .eq('status', 'pending_approval')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[admin/meetings] query error:', error.code, error.message)
  }

  const meetings: PendingMeeting[] = data ?? []

  // Fetch active operators for assignment dropdown via secure RPC
  const { data: operatorData } = await supabase.rpc('get_meeting_manager_candidates')

  const operators: OperatorOption[] = (operatorData ?? []).map((op: any) => ({
    id: op.user_id,
    member_no: op.member_no,
    legal_name: op.legal_name ?? null,
  }))

  const { data: paymentData, error: paymentError } = await supabase.rpc('get_pending_meeting_payments')
  if (paymentError) console.error('[admin/meetings] payment query error:', paymentError.code, paymentError.message)
  const payments: PendingPayment[] = paymentData ?? []

  return (
    <main className="iuna-page">
      <div className="iuna-container space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="iuna-eyebrow">관리 · 모임</p>
            <h1 className="iuna-page-title mt-1">모임 승인</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              개설 요청된 모임을 확인하고 승인 또는 반려합니다.
            </p>
          </div>
          {meetings.length > 0 && (
            <span className="rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs font-medium text-amber-700">
              대기 {meetings.length}건
            </span>
          )}
        </div>
        <MeetingApprovalClient meetings={meetings} operators={operators} />
        <PaymentConfirmationClient payments={payments} />
      </div>
    </main>
  )
}
