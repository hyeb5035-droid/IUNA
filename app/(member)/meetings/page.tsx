import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '../../../lib/supabase/server'
import { getCurrentMemberAuth } from '../../../lib/supabase/auth'
import MeetingsListClient from './MeetingsListClient'

const TYPE_LABEL: Record<string, string> = {
  lecture: '강의',
  study: '스터디',
  project: '프로젝트',
  lightning: '번개',
  regular_networking: '정기 네트워킹',
}

const STATUS_LABEL: Record<string, string> = {
  pending_approval: '승인대기',
  recruiting: '모집중',
  active: '활동중',
  ended: '종료',
  cancelled: '취소',
  rejected: '반려',
}

function formatDate(value: string | null) {
  if (!value) return null
  return new Date(value).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export type MeetingListItem = {
  id: string
  meeting_type: string
  title: string
  status: string
  period_start: string | null
  period_end: string | null
  capacity: number | null
  creator_name: string | null
}

export default async function MeetingsPage() {
  const auth = await getCurrentMemberAuth()

  if (!auth.session?.user) {
    redirect('/login')
  }

  const canCreate =
    auth.isOperator || auth.membership?.grade === 'regular' || auth.membership?.grade === 'honorary'

  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('meetings')
    .select('id, meeting_type, title, description, status, period_start, period_end, capacity')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  const meetings = error ? [] : (data ?? [])

  // Fetch creator names in one batch
  const meetingIds = meetings.map((m) => m.id)
  let creatorMap: Record<string, { legal_name: string | null }> = {}

  if (meetingIds.length > 0) {
    const { data: creatorData } = await supabase.rpc('get_meeting_creator_summaries', {
      p_meeting_ids: meetingIds,
    })
    for (const c of (creatorData ?? [])) {
      creatorMap[c.meeting_id] = { legal_name: c.legal_name ?? null }
    }
  }

  const items: MeetingListItem[] = meetings.map((m) => ({
    id: m.id,
    meeting_type: m.meeting_type,
    title: m.title,
    status: m.status,
    period_start: m.period_start,
    period_end: m.period_end,
    capacity: m.capacity,
    creator_name: creatorMap[m.id]?.legal_name ?? null,
  }))

  return (
    <main className="iuna-page">
      <div className="iuna-container space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="iuna-eyebrow">{meetings.length}개의 모임</p>
            <h1 className="iuna-page-title mt-1">모임</h1>
          </div>
          {canCreate && (
            <Link
              href="/meetings/new"
              className="iuna-primary"
            >
              모임 개설
            </Link>
          )}
        </div>

        {/* Client-side filters + list */}
        <MeetingsListClient meetings={items} />
      </div>
    </main>
  )
}
