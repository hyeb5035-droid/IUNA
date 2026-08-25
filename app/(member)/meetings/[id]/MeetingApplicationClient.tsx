'use client'

import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
const supabase = createBrowserClient(supabaseUrl, supabaseKey)

const APP_STATUS_LABEL: Record<string, string> = {
  pending: '신청대기',
  approved: '승인',
  rejected: '반려',
  cancelled: '취소',
}

const APP_STATUS_COLOR: Record<string, string> = {
  pending: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-red-50 text-red-600 border-red-200',
  cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
}

type ApplicationData = {
  id: string
  status: string
  rejection_reason: string | null
  created_at: string
} | null

type Props = {
  meetingId: string
  meetingStatus: string
  meetingType: string | null
  isCreator: boolean
  userGrade: string
  isOperator: boolean
  myApplication: ApplicationData
}

export default function MeetingApplicationClient({ meetingId, meetingStatus, meetingType, isCreator, userGrade, isOperator, myApplication }: Props) {
  const [application, setApplication] = useState<ApplicationData>(myApplication)
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const isRegularNetworking = meetingType === 'regular_networking'
  const isIneligibleAssociate = userGrade === 'associate' && !isOperator
  const canApply = meetingStatus === 'recruiting' && !isCreator && !application && !(isRegularNetworking && isIneligibleAssociate)
  const canCancel =
    application &&
    (application.status === 'pending' || application.status === 'approved') &&
    meetingStatus !== 'active' &&
    meetingStatus !== 'ended'

  async function handleApply() {
    setIsLoading(true)
    setMessage(null)

    const { data, error } = await supabase.rpc('apply_to_meeting', {
      p_meeting_id: meetingId,
    })

    if (error) {
      const msg = error.message ?? ''
      let userMsg = '신청 중 오류가 발생했습니다.'
      if (msg.includes('MEETING_NOT_RECRUITING')) userMsg = '현재 모집중이 아닙니다.'
      else if (msg.includes('ALREADY_APPLIED')) userMsg = '이미 신청한 모임입니다.'
      else if (msg.includes('REGULAR_ONLY_MEETING')) userMsg = '정회원 전용 모임입니다.'
      else if (msg.includes('REGULAR_NETWORKING_NOT_ELIGIBLE')) userMsg = '정기 네트워킹은 정회원 이상 신청할 수 있습니다.'
      else if (msg.includes('CREATOR_CANNOT_APPLY')) userMsg = '개설자는 자동 참여됩니다.'
      setMessage({ type: 'error', text: userMsg })
    } else {
      setApplication({ id: data, status: 'pending', rejection_reason: null, created_at: new Date().toISOString() })
      setMessage({ type: 'success', text: '신청이 완료되었습니다.' })
    }

    setIsLoading(false)
  }

  async function handleCancel() {
    if (!application) return
    setIsLoading(true)
    setMessage(null)

    const { error } = await supabase.rpc('cancel_meeting_application', {
      p_application_id: application.id,
    })

    if (error) {
      const msg = error.message ?? ''
      let userMsg = '취소 중 오류가 발생했습니다.'
      if (msg.includes('MEETING_ALREADY_ACTIVE')) userMsg = '활동 시작 후에는 취소할 수 없습니다.'
      else if (msg.includes('CANNOT_CANCEL_STATUS')) userMsg = '현재 상태에서는 취소할 수 없습니다.'
      setMessage({ type: 'error', text: userMsg })
    } else {
      setApplication({ ...application, status: 'cancelled', rejection_reason: null })
      setMessage({ type: 'success', text: '신청이 취소되었습니다.' })
    }

    setIsLoading(false)
  }

  // Creator sees nothing in application section
  if (isCreator) {
    return (
      <section className="rounded-3xl bg-white border border-[#DDDCD7] p-6 shadow-sm">
        <p className="text-sm text-slate-500">개설자는 자동으로 참여됩니다.</p>
      </section>
    )
  }

  return (
    <section className="rounded-3xl bg-white border border-[#DDDCD7] p-6 shadow-sm space-y-4">
      <h3 className="text-sm font-semibold">참여 신청</h3>

      {/* Current application status */}
      {application && (
        <div className="rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">신청 상태:</span>
            <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${APP_STATUS_COLOR[application.status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
              {APP_STATUS_LABEL[application.status] ?? application.status}
            </span>
          </div>
          {application.status === 'rejected' && application.rejection_reason && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3">
              <p className="text-xs text-red-600">{application.rejection_reason}</p>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        {canApply && (
          <button
            onClick={handleApply}
            disabled={isLoading}
            className="rounded-2xl bg-[#0A0A0A] px-5 py-3 text-sm font-semibold text-white hover:bg-slate-900 transition disabled:opacity-50"
          >
            {isLoading ? '신청 중...' : '신청하기'}
          </button>
        )}

        {canCancel && (
          <button
            onClick={handleCancel}
            disabled={isLoading}
            className="rounded-2xl border border-[#DDDCD7] px-5 py-3 text-sm font-medium text-slate-600 hover:bg-[#F5F4F1] transition disabled:opacity-50"
          >
            {isLoading ? '취소 중...' : '신청 취소'}
          </button>
        )}
      </div>

      {/* Messages */}
      {message && (
        <p className={`text-sm ${message.type === 'success' ? 'text-emerald-600' : 'text-red-500'}`}>
          {message.text}
        </p>
      )}

      {/* Not recruiting state */}
      {meetingStatus !== 'recruiting' && !application && (
        <p className="text-sm text-slate-400">현재 모집 기간이 아닙니다.</p>
      )}

      {/* Ineligible associate for regular networking */}
      {meetingStatus === 'recruiting' && !application && isRegularNetworking && isIneligibleAssociate && (
        <p className="text-sm text-slate-400">정기 네트워킹은 정회원 이상 신청할 수 있습니다.</p>
      )}
    </section>
  )
}
