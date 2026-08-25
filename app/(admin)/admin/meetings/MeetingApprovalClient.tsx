'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { PendingMeeting, OperatorOption } from './page'

const TYPE_LABEL: Record<string, string> = {
  lecture: '강의',
  study: '스터디',
  project: '프로젝트',
  lightning: '번개',
  regular_networking: '정기 네트워킹',
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

type Props = { meetings: PendingMeeting[]; operators: OperatorOption[] }

type DialogState = {
  meeting: PendingMeeting | null
  mode: 'approve' | 'reject' | null
  assignedOperatorId: string
  projectPointValue: string
  rejectionReason: string
  status: 'idle' | 'loading' | 'success' | 'error'
  message: string
}

export default function MeetingApprovalClient({ meetings: initial, operators }: Props) {
  const [meetings, setMeetings] = useState(initial)
  const [dialog, setDialog] = useState<DialogState>({
    meeting: null, mode: null, assignedOperatorId: '', projectPointValue: '3', rejectionReason: '', status: 'idle', message: '',
  })

  function openApprove(m: PendingMeeting) {
    setDialog({ meeting: m, mode: 'approve', assignedOperatorId: operators[0]?.id ?? '', projectPointValue: '3', rejectionReason: '', status: 'idle', message: '' })
  }

  function openReject(m: PendingMeeting) {
    setDialog({ meeting: m, mode: 'reject', assignedOperatorId: '', projectPointValue: '3', rejectionReason: '', status: 'idle', message: '' })
  }

  function closeDialog() {
    setDialog({ meeting: null, mode: null, assignedOperatorId: '', projectPointValue: '3', rejectionReason: '', status: 'idle', message: '' })
  }

  async function handleSubmit() {
    if (!dialog.meeting || !dialog.mode) return

    if (dialog.mode === 'approve' && !dialog.assignedOperatorId) {
      setDialog((d) => ({ ...d, status: 'error', message: '담당 운영진을 선택해주세요.' }))
      return
    }

    if (dialog.mode === 'reject' && !dialog.rejectionReason.trim()) {
      setDialog((d) => ({ ...d, status: 'error', message: '반려 사유를 입력해주세요.' }))
      return
    }

    setDialog((d) => ({ ...d, status: 'loading', message: '' }))

    try {
      const res = await fetch('/api/admin/meetings/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meeting_id: dialog.meeting.id,
          decision: dialog.mode,
          assigned_operator_id: dialog.mode === 'approve' ? dialog.assignedOperatorId : null,
          rejection_reason: dialog.mode === 'reject' ? dialog.rejectionReason.trim() : null,
          project_point_value: dialog.mode === 'approve' && dialog.meeting.meeting_type === 'project' ? Number(dialog.projectPointValue) : null,
        }),
      })

      const body = await res.json().catch(() => ({}))

      if (res.ok) {
        setMeetings((prev) => prev.filter((m) => m.id !== dialog.meeting!.id))
        setDialog((d) => ({ ...d, status: 'success', message: dialog.mode === 'approve' ? '승인되었습니다.' : '반려되었습니다.' }))
      } else {
        setDialog((d) => ({ ...d, status: 'error', message: body.error ?? '처리 중 오류가 발생했습니다.' }))
      }
    } catch {
      setDialog((d) => ({ ...d, status: 'error', message: '네트워크 오류가 발생했습니다.' }))
    }
  }

  return (
    <>
      {meetings.length === 0 && !dialog.meeting ? (
        <div className="rounded-2xl border border-[#E5E1DA] bg-white px-4 py-12 text-center">
          <p className="text-sm text-slate-400">승인대기 중인 모임이 없습니다.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-[#E5E1DA] bg-white overflow-hidden">
          {meetings.map((m) => (
            <div key={m.id} className="border-b border-[#E5E1DA] last:border-b-0 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="rounded-full bg-[#F5F4F1] px-2 py-0.5 text-[11px]">
                      {TYPE_LABEL[m.meeting_type ?? ''] ?? m.meeting_type ?? '미분류'}
                    </span>
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      승인대기
                    </span>
                  </div>
                  <h2 className="text-sm font-semibold truncate">{m.title}</h2>
                  <p className="text-xs text-slate-400 mt-0.5">{formatDate(m.created_at)} 생성</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Link
                    href={`/meetings/${m.id}`}
                    className="rounded-lg border border-[#E5E1DA] px-2.5 py-1.5 text-xs font-medium hover:bg-[#F5F4F1] transition"
                  >
                    상세
                  </Link>
                  <button
                    onClick={() => openApprove(m)}
                    className="rounded-lg bg-[#111111] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-900 transition"
                  >
                    승인
                  </button>
                  <button
                    onClick={() => openReject(m)}
                    className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition"
                  >
                    반려
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dialog */}
      {dialog.meeting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white border border-[#E5E1DA] p-6 shadow-xl">
            {dialog.status === 'success' ? (
              <>
                <h2 className="text-lg font-semibold text-emerald-700">{dialog.message}</h2>
                <button onClick={closeDialog} className="mt-5 w-full rounded-xl bg-[#111111] px-5 py-3 text-sm font-semibold text-white hover:bg-slate-900 transition">
                  확인
                </button>
              </>
            ) : dialog.mode === 'approve' ? (
              <>
                <h2 className="text-lg font-semibold">모임 승인</h2>
                <p className="mt-2 text-sm text-slate-600">
                  <span className="font-medium">{dialog.meeting.title}</span>을(를) 승인합니다.
                </p>
                <div className="mt-4">
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">담당 운영진 *</label>
                  <select
                    value={dialog.assignedOperatorId}
                    onChange={(e) => setDialog((d) => ({ ...d, assignedOperatorId: e.target.value }))}
                    disabled={dialog.status === 'loading'}
                    className="w-full rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm outline-none focus:border-[#111111]"
                  >
                    {operators.length === 0 && <option value="">운영진 없음</option>}
                    {operators.map((op) => (
                      <option key={op.id} value={op.id}>
                        {op.legal_name ?? '이름없음'} ({op.member_no})
                      </option>
                    ))}
                  </select>
                </div>
                {dialog.meeting?.meeting_type === 'project' && (
                  <div className="mt-4">
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">프로젝트 포인트 *</label>
                    <div className="flex gap-2">
                      {['3', '4', '5'].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setDialog((d) => ({ ...d, projectPointValue: v }))}
                          className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition ${
                            dialog.projectPointValue === v
                              ? 'bg-[#111111] text-white'
                              : 'border border-[#E5E1DA] hover:bg-[#F5F4F1]'
                          }`}
                        >
                          {v}점
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {dialog.status === 'error' && <p className="mt-3 text-sm text-red-500">{dialog.message}</p>}
                <div className="mt-5 flex gap-3">
                  <button onClick={handleSubmit} disabled={dialog.status === 'loading'} className="flex-1 rounded-xl bg-[#111111] px-5 py-3 text-sm font-semibold text-white hover:bg-slate-900 transition disabled:opacity-50">
                    {dialog.status === 'loading' ? '처리 중...' : '승인'}
                  </button>
                  <button onClick={closeDialog} disabled={dialog.status === 'loading'} className="flex-1 rounded-xl border border-[#E5E1DA] px-5 py-3 text-sm font-semibold transition hover:bg-[#F5F4F1] disabled:opacity-50">
                    취소
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold">모임 반려</h2>
                <p className="mt-2 text-sm text-slate-600">
                  <span className="font-medium">{dialog.meeting.title}</span>을(를) 반려합니다.
                </p>
                <div className="mt-4">
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">반려 사유 *</label>
                  <textarea
                    rows={3}
                    value={dialog.rejectionReason}
                    onChange={(e) => setDialog((d) => ({ ...d, rejectionReason: e.target.value }))}
                    disabled={dialog.status === 'loading'}
                    placeholder="구체적인 반려 사유를 입력해주세요."
                    className="w-full rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm outline-none focus:border-[#111111]"
                  />
                </div>
                {dialog.status === 'error' && <p className="mt-3 text-sm text-red-500">{dialog.message}</p>}
                <div className="mt-5 flex gap-3">
                  <button onClick={handleSubmit} disabled={dialog.status === 'loading'} className="flex-1 rounded-xl bg-red-600 px-5 py-3 text-sm font-semibold text-white hover:bg-red-700 transition disabled:opacity-50">
                    {dialog.status === 'loading' ? '처리 중...' : '반려 확정'}
                  </button>
                  <button onClick={closeDialog} disabled={dialog.status === 'loading'} className="flex-1 rounded-xl border border-[#E5E1DA] px-5 py-3 text-sm font-semibold transition hover:bg-[#F5F4F1] disabled:opacity-50">
                    취소
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
