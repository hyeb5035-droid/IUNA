'use client'

import { useState } from 'react'
import { createBrowserSupabaseClient } from '../../../../lib/supabase/client'

export type PendingPayment = {
  application_id: string
  meeting_id: string
  meeting_title: string
  applicant_id: string
  applicant_name: string | null
  member_no: string
  applied_at: string
}

export default function PaymentConfirmationClient({ payments: initial }: { payments: PendingPayment[] }) {
  const [payments, setPayments] = useState(initial)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  async function confirm(applicationId: string) {
    setLoadingId(applicationId)
    setMessage('')
    const supabase = createBrowserSupabaseClient()
    const { error } = await supabase.rpc('confirm_meeting_payment', { p_application_id: applicationId })
    if (error) {
      const code = error.message ?? ''
      setMessage(code.includes('APPLICATION_NOT_PAYMENT_PENDING') ? '이미 처리되었거나 입금 대기 상태가 아닙니다.' : code.includes('MEETING_ADMIN_REQUIRED') ? '입금 확인 권한이 없습니다.' : '입금 확인 처리에 실패했습니다.')
    } else {
      setPayments((prev) => prev.filter((payment) => payment.application_id !== applicationId))
      setMessage('입금 확인 및 참가 확정이 완료되었습니다.')
    }
    setLoadingId(null)
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold">모임 회비 입금 확인</h2><p className="text-xs text-slate-500">모임장 승인 후 입금 대기 중인 신청입니다.</p></div>
        <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">대기 {payments.length}건</span>
      </div>
      {message && <p className="rounded-xl border bg-white p-3 text-sm">{message}</p>}
      {payments.length === 0 ? <div className="rounded-2xl border bg-white p-6 text-sm text-slate-400">입금 확인 대기 신청이 없습니다.</div> : (
        <div className="divide-y overflow-hidden rounded-2xl border bg-white">
          {payments.map((payment) => (
            <div key={payment.application_id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
              <div><p className="font-medium">{payment.applicant_name ?? '이름 없음'} <span className="font-mono text-xs text-slate-400">{payment.member_no}</span></p><p className="mt-1 text-sm text-slate-600">{payment.meeting_title}</p><p className="mt-1 text-xs text-blue-700">입금 대기 · 회비 3,000원</p></div>
              <button onClick={() => confirm(payment.application_id)} disabled={loadingId === payment.application_id} className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{loadingId === payment.application_id ? '처리 중...' : '입금 확인 및 참가 확정'}</button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
