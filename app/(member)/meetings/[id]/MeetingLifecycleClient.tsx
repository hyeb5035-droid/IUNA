'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
const supabase = createBrowserClient(supabaseUrl, supabaseKey)

type Props = {
  meetingId: string
  meetingStatus: string
  isCreator: boolean
}

export default function MeetingLifecycleClient({ meetingId, meetingStatus, isCreator }: Props) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  if (!isCreator) return null

  const canStart = meetingStatus === 'recruiting'
  const canEnd = meetingStatus === 'active'

  if (!canStart && !canEnd) return null

  async function handleStart() {
    setIsLoading(true)
    setMessage(null)

    const { error } = await supabase.rpc('start_meeting', { p_meeting_id: meetingId })

    if (error) {
      const msg = error.message ?? ''
      let userMsg = '모임 시작 중 오류가 발생했습니다.'
      if (msg.includes('NOT_RECRUITING')) userMsg = '모집중 상태의 모임만 시작할 수 있습니다.'
      setMessage({ type: 'error', text: userMsg })
    } else {
      setMessage({ type: 'success', text: '모임이 시작되었습니다.' })
      setTimeout(() => router.refresh(), 500)
    }
    setIsLoading(false)
  }

  async function handleEnd() {
    setIsLoading(true)
    setMessage(null)

    const { error } = await supabase.rpc('end_meeting', { p_meeting_id: meetingId })

    if (error) {
      const msg = error.message ?? ''
      let userMsg = '모임 종료 중 오류가 발생했습니다.'
      if (msg.includes('MEETING_NOT_ACTIVE')) userMsg = '활동중 상태의 모임만 종료할 수 있습니다.'
      else if (msg.includes('UNRESOLVED_PARTICIPANTS')) userMsg = '모든 참여자의 완료 여부를 결정해주세요.'
      setMessage({ type: 'error', text: userMsg })
    } else {
      setMessage({ type: 'success', text: '모임이 종료되었습니다.' })
      setTimeout(() => router.refresh(), 500)
    }
    setIsLoading(false)
  }

  return (
    <section className="rounded-3xl bg-white border border-[#DDDCD7] p-6 shadow-sm space-y-3">
      <h3 className="text-sm font-semibold">모임 관리</h3>
      <div className="flex gap-3">
        {canStart && (
          <button
            onClick={handleStart}
            disabled={isLoading}
            className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition disabled:opacity-50"
          >
            {isLoading ? '처리 중...' : '모임 시작'}
          </button>
        )}
        {canEnd && (
          <button
            onClick={handleEnd}
            disabled={isLoading}
            className="rounded-2xl bg-slate-700 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 transition disabled:opacity-50"
          >
            {isLoading ? '처리 중...' : '모임 종료'}
          </button>
        )}
        {canEnd && (
          <a
            href={`/meetings/${meetingId}/attendance`}
            className="rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] px-5 py-3 text-sm font-medium hover:bg-white transition"
          >
            출석/완료 관리
          </a>
        )}
      </div>
      {message && (
        <p className={`text-sm ${message.type === 'success' ? 'text-emerald-600' : 'text-red-500'}`}>
          {message.text}
        </p>
      )}
    </section>
  )
}
