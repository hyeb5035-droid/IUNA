'use client'

import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
const supabase = createBrowserClient(supabaseUrl, supabaseKey)

type PendingApplicant = {
  id: string
  applicant_id: string
  legal_name: string | null
  company_name: string | null
  job_title: string | null
  created_at: string
}

type Props = { applicants: PendingApplicant[] }

export default function PendingApplicantsClient({ applicants: initial }: Props) {
  const [applicants, setApplicants] = useState(initial)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  if (applicants.length === 0) return null

  async function handleApprove(appId: string) {
    setLoadingId(appId)
    setMessage(null)
    const { error } = await supabase.rpc('review_meeting_application', {
      p_application_id: appId,
      p_decision: 'approve',
      p_reason: null,
    })
    if (error) {
      const msg = error.message ?? ''
      setMessage({ type: 'error', text: msg.includes('CAPACITY_FULL') ? '정원 초과' : '승인 실패' })
    } else {
      setApplicants((prev) => prev.filter((a) => a.id !== appId))
      setMessage({ type: 'success', text: '승인되었습니다.' })
    }
    setLoadingId(null)
  }

  async function submitReject() {
    if (!rejectId || !reason.trim()) return
    setLoadingId(rejectId)
    setMessage(null)
    const { error } = await supabase.rpc('review_meeting_application', {
      p_application_id: rejectId,
      p_decision: 'reject',
      p_reason: reason.trim(),
    })
    if (error) {
      setMessage({ type: 'error', text: '반려 실패' })
    } else {
      setApplicants((prev) => prev.filter((a) => a.id !== rejectId))
      setMessage({ type: 'success', text: '반려되었습니다.' })
    }
    setRejectId(null)
    setReason('')
    setLoadingId(null)
  }

  return (
    <div className="mt-5 space-y-3">
      <h4 className="text-xs font-semibold text-yellow-700">대기 중 신청 ({applicants.length})</h4>

      {message && (
        <p className={`text-xs ${message.type === 'success' ? 'text-emerald-600' : 'text-red-500'}`}>{message.text}</p>
      )}

      {applicants.map((a) => (
        <div key={a.id} className="flex items-center justify-between gap-3 rounded-2xl border border-yellow-200 bg-yellow-50 p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">{a.legal_name ?? '이름 없음'}</p>
            {(a.company_name || a.job_title) && (
              <p className="text-xs text-slate-500">{[a.company_name, a.job_title].filter(Boolean).join(' · ')}</p>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => handleApprove(a.id)}
              disabled={!!loadingId}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 transition disabled:opacity-50"
            >
              승인
            </button>
            <button
              onClick={() => setRejectId(a.id)}
              disabled={!!loadingId}
              className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 transition disabled:opacity-50"
            >
              반려
            </button>
          </div>
        </div>
      ))}

      {/* Inline reject reason */}
      {rejectId && (
        <div className="rounded-2xl border border-[#DDDCD7] bg-white p-4 space-y-3">
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="반려 사유를 입력해주세요."
            className="w-full rounded-xl border border-[#DDDCD7] bg-[#F5F4F1] px-3 py-2 text-sm outline-none focus:border-[#0A0A0A]"
          />
          <div className="flex gap-2">
            <button onClick={submitReject} disabled={!reason.trim() || !!loadingId} className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">반려 확인</button>
            <button onClick={() => { setRejectId(null); setReason('') }} className="rounded-lg border border-[#DDDCD7] px-3 py-1.5 text-xs font-medium">취소</button>
          </div>
        </div>
      )}
    </div>
  )
}
