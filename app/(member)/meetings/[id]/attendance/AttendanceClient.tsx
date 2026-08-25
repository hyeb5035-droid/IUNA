'use client'

import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { ParticipantRow } from './page'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
const supabase = createBrowserClient(supabaseUrl, supabaseKey)

const TYPE_LABEL: Record<string, string> = {
  host: '개설자',
  operator: '담당 운영진',
  normal: '신청 승인',
}

const GRADE_LABEL: Record<string, string> = {
  associate: '준회원',
  regular: '정회원',
  honorary: '명예회원',
}

type Props = {
  meetingId: string
  participants: ParticipantRow[]
}

export default function AttendanceClient({ meetingId, participants: initial }: Props) {
  const [participants, setParticipants] = useState(initial)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  async function handleSetCompletion(participantId: string, completed: boolean) {
    setLoadingId(participantId)
    setMessage(null)

    const { error } = await supabase.rpc('set_participant_completion', {
      p_meeting_id: meetingId,
      p_participant_id: participantId,
      p_completed: completed,
    })

    if (error) {
      const msg = error.message ?? ''
      let userMsg = '처리 중 오류가 발생했습니다.'
      if (msg.includes('CREATOR_ONLY')) userMsg = '개설자만 완료 처리할 수 있습니다.'
      else if (msg.includes('MEETING_NOT_ACTIVE')) userMsg = '활동중 상태의 모임만 관리할 수 있습니다.'
      else if (msg.includes('PARTICIPANT_NOT_FOUND')) userMsg = '참여자를 찾을 수 없습니다.'
      setMessage({ type: 'error', text: userMsg })
    } else {
      setParticipants((prev) =>
        prev.map((p) => p.applicant_id === participantId ? { ...p, completed } : p),
      )
      setMessage({ type: 'success', text: completed ? '완료 처리되었습니다.' : '미완료 처리되었습니다.' })
    }
    setLoadingId(null)
  }

  const allResolved = participants.every((p) => p.completed !== null)

  return (
    <>
      {message && (
        <div className={`rounded-2xl px-5 py-3 text-sm border ${message.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-600'}`}>
          {message.text}
        </div>
      )}

      {!allResolved && (
        <div className="rounded-2xl bg-yellow-50 border border-yellow-200 px-5 py-3 text-sm text-yellow-700">
          모든 참여자의 완료 여부를 결정해야 모임을 종료할 수 있습니다.
        </div>
      )}

      <div className="rounded-3xl bg-white border border-[#DDDCD7] shadow-sm overflow-hidden divide-y divide-[#DDDCD7]">
        {participants.length === 0 ? (
          <p className="px-6 py-10 text-sm text-slate-400 text-center">참여자가 없습니다.</p>
        ) : (
          participants.map((p) => (
            <div key={p.applicant_id} className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-full bg-[#DDDCD7] shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{p.legal_name ?? '이름 없음'}</span>
                      <span className="text-xs text-slate-400">{TYPE_LABEL[p.application_type] ?? ''}</span>
                    </div>
                    {(p.company_name || p.job_title) && (
                      <p className="text-xs text-slate-500 truncate">
                        {[p.company_name, p.job_title].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                </div>

                <div className="shrink-0 flex items-center gap-2">
                  {p.completed === true && (
                    <span className="inline-flex rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-medium text-emerald-700">완료</span>
                  )}
                  {p.completed === false && (
                    <span className="inline-flex rounded-full bg-red-50 border border-red-200 px-3 py-1 text-xs font-medium text-red-600">미완료</span>
                  )}
                  {p.completed === null && (
                    <>
                      <button
                        onClick={() => handleSetCompletion(p.applicant_id, true)}
                        disabled={loadingId === p.applicant_id}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 transition disabled:opacity-50"
                      >
                        완료
                      </button>
                      <button
                        onClick={() => handleSetCompletion(p.applicant_id, false)}
                        disabled={loadingId === p.applicant_id}
                        className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 transition disabled:opacity-50"
                      >
                        미완료
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  )
}
