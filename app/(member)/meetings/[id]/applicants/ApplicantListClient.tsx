'use client'

import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { ApplicantRow } from './page'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
const supabase = createBrowserClient(supabaseUrl, supabaseKey)

const STATUS_LABEL: Record<string, string> = {
  pending: '신청대기',
  approved: '승인',
  rejected: '반려',
  cancelled: '취소',
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-red-50 text-red-600 border-red-200',
  cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
}

const GRADE_LABEL: Record<string, string> = {
  associate: '준회원',
  regular: '정회원',
  honorary: '명예회원',
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

type Props = { applicants: ApplicantRow[]; meetingStatus: string }

type RejectDialog = {
  applicationId: string
  reason: string
  status: 'idle' | 'loading' | 'error'
  message: string
} | null

export default function ApplicantListClient({ applicants: initial, meetingStatus }: Props) {
  const [applicants, setApplicants] = useState(initial)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [rejectDialog, setRejectDialog] = useState<RejectDialog>(null)

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
      let userMsg = '승인 처리 중 오류가 발생했습니다.'
      if (msg.includes('MEETING_CAPACITY_FULL')) userMsg = '정원이 초과되었습니다.'
      else if (msg.includes('APPLICATION_NOT_PENDING')) userMsg = '대기 상태의 신청만 승인할 수 있습니다.'
      else if (msg.includes('MEETING_ACCESS_DENIED')) userMsg = '관리 권한이 없습니다.'
      setMessage({ type: 'error', text: userMsg })
    } else {
      setApplicants((prev) => prev.map((a) => a.id === appId ? { ...a, status: 'approved' } : a))
      setMessage({ type: 'success', text: '승인되었습니다.' })
    }

    setLoadingId(null)
  }

  function openRejectDialog(appId: string) {
    setRejectDialog({ applicationId: appId, reason: '', status: 'idle', message: '' })
  }

  async function submitReject() {
    if (!rejectDialog || !rejectDialog.reason.trim()) {
      setRejectDialog((d) => d ? { ...d, status: 'error', message: '반려 사유를 입력해주세요.' } : null)
      return
    }

    setRejectDialog((d) => d ? { ...d, status: 'loading' } : null)

    const { error } = await supabase.rpc('review_meeting_application', {
      p_application_id: rejectDialog.applicationId,
      p_decision: 'reject',
      p_reason: rejectDialog.reason.trim(),
    })

    if (error) {
      const msg = error.message ?? ''
      let userMsg = '반려 처리 중 오류가 발생했습니다.'
      if (msg.includes('MEETING_ACCESS_DENIED')) userMsg = '관리 권한이 없습니다.'
      setRejectDialog((d) => d ? { ...d, status: 'error', message: userMsg } : null)
    } else {
      setApplicants((prev) =>
        prev.map((a) =>
          a.id === rejectDialog.applicationId
            ? { ...a, status: 'rejected', rejection_reason: rejectDialog.reason.trim() }
            : a,
        ),
      )
      setMessage({ type: 'success', text: '반려되었습니다.' })
      setRejectDialog(null)
    }
  }

  if (applicants.length === 0) {
    return (
      <div className="rounded-3xl bg-white border border-[#DDDCD7] p-10 shadow-sm text-center">
        <p className="text-slate-400 text-sm">신청자가 없습니다.</p>
      </div>
    )
  }

  return (
    <>
      {message && (
        <div className={`rounded-2xl px-5 py-3 text-sm border ${message.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-600'}`}>
          {message.text}
        </div>
      )}

      <div className="rounded-3xl bg-white border border-[#DDDCD7] shadow-sm overflow-hidden divide-y divide-[#DDDCD7]">
        {applicants.map((a) => (
          <div key={a.id} className="p-5 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{a.legal_name ?? '이름 없음'}</span>
                  <span className="text-xs text-slate-400">{GRADE_LABEL[a.grade] ?? a.grade}</span>
                </div>
                {(a.company_name || a.job_title) && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    {[a.company_name, a.job_title].filter(Boolean).join(' · ')}
                  </p>
                )}
                <div className="mt-1 flex items-center gap-2">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[a.status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                    {STATUS_LABEL[a.status] ?? a.status}
                  </span>
                  <span className="text-xs text-slate-400">{formatDate(a.created_at)} 신청</span>
                </div>
                {a.status === 'rejected' && a.rejection_reason && (
                  <p className="mt-1 text-xs text-red-500">사유: {a.rejection_reason}</p>
                )}
              </div>
              {a.status === 'pending' && (
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleApprove(a.id)}
                    disabled={loadingId === a.id}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 transition disabled:opacity-50"
                  >
                    승인
                  </button>
                  <button
                    onClick={() => openRejectDialog(a.id)}
                    disabled={loadingId === a.id}
                    className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 transition disabled:opacity-50"
                  >
                    반려
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Reject Dialog */}
      {rejectDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-3xl bg-white border border-[#DDDCD7] p-8 shadow-xl">
            <h2 className="text-lg font-semibold">신청 반려</h2>
            <div className="mt-4">
              <label className="block text-sm font-medium mb-1.5">반려 사유 *</label>
              <textarea
                rows={3}
                value={rejectDialog.reason}
                onChange={(e) => setRejectDialog((d) => d ? { ...d, reason: e.target.value } : null)}
                disabled={rejectDialog.status === 'loading'}
                placeholder="구체적인 반려 사유를 입력해주세요."
                className="w-full rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] px-4 py-3 text-sm outline-none focus:border-[#0A0A0A]"
              />
            </div>
            {rejectDialog.status === 'error' && (
              <p className="mt-2 text-sm text-red-500">{rejectDialog.message}</p>
            )}
            <div className="mt-6 flex gap-3">
              <button
                onClick={submitReject}
                disabled={rejectDialog.status === 'loading'}
                className="flex-1 rounded-2xl bg-red-500 px-5 py-3 text-sm font-semibold text-white hover:bg-red-600 transition disabled:opacity-50"
              >
                {rejectDialog.status === 'loading' ? '처리 중...' : '반려 확인'}
              </button>
              <button
                onClick={() => setRejectDialog(null)}
                disabled={rejectDialog.status === 'loading'}
                className="flex-1 rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] px-5 py-3 text-sm font-semibold transition hover:bg-white disabled:opacity-50"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
