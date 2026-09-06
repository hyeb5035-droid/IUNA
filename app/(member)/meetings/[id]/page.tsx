import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '../../../../lib/supabase/server'
import { getCurrentMemberAuth } from '../../../../lib/supabase/auth'
import MeetingApplicationClient from './MeetingApplicationClient'
import MeetingLifecycleClient from './MeetingLifecycleClient'
import PendingApplicantsClient from './PendingApplicantsClient'

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

const STATUS_COLOR: Record<string, string> = {
  pending_approval: 'bg-amber-50 text-amber-700 border-amber-200',
  recruiting: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  active: 'bg-blue-50 text-blue-700 border-blue-200',
  ended: 'bg-slate-100 text-slate-500 border-slate-200',
  cancelled: 'bg-red-50 text-red-600 border-red-200',
  rejected: 'bg-red-50 text-red-600 border-red-200',
}

function formatDate(value: string | null) {
  if (!value) return null
  return new Date(value).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
}

export default async function MeetingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const auth = await getCurrentMemberAuth()
  if (!auth.session?.user) {
    redirect('/login')
  }

  const userId = auth.session.user.id
  const supabase = await createServerSupabaseClient()

  const { data: meeting, error } = await supabase
    .from('meetings')
    .select(`
      id, meeting_type, title, description, goals, details,
      period_start, period_end, capacity, support_request,
      regular_only, lecture_fee, revenue_share_organizer, revenue_share_member,
      status, rejection_reason, created_by, created_at, project_point_value
    `)
    .eq('id', id)
    .is('deleted_at', null)
    .single()

  if (error || !meeting) {
    notFound()
  }

  // Check if user is creator/manager
  const isCreator = meeting.created_by === userId
  const { data: managerRow } = await supabase
    .from('meeting_managers')
    .select('id')
    .eq('meeting_id', id)
    .eq('user_id', userId)
    .is('ended_at', null)
    .limit(1)
    .maybeSingle()

  const canManage = isCreator

  // Fetch current user's application
  const { data: myApplication } = await supabase
    .from('meeting_applications')
    .select('id, status, rejection_reason, created_at')
    .eq('meeting_id', id)
    .eq('applicant_id', userId)
    .maybeSingle()

  // Fetch approved participants via RPC
  const { data: participants } = await supabase.rpc('get_meeting_approved_participants', {
    p_meeting_id: id,
  })

  // For creator: also fetch pending applicants
  let pendingApplicants: Array<{ id: string; applicant_id: string; legal_name: string | null; company_name: string | null; job_title: string | null; created_at: string }> = []
  if (isCreator) {
    const { data: pendingData } = await supabase
      .from('meeting_applications')
      .select('id, applicant_id, created_at')
      .eq('meeting_id', id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })

    if (pendingData && pendingData.length > 0) {
      const applicantIds = pendingData.map((a) => a.applicant_id)
      const { data: profileData } = await supabase
        .from('profiles')
        .select('id, company_name, job_title, profile_private!inner(legal_name)')
        .in('id', applicantIds)

      const profileMap: Record<string, { legal_name: string | null; company_name: string | null; job_title: string | null }> = {}
      for (const p of (profileData ?? [])) {
        const priv = Array.isArray(p.profile_private) ? p.profile_private[0] : p.profile_private
        profileMap[p.id] = { legal_name: (priv as any)?.legal_name ?? null, company_name: p.company_name, job_title: p.job_title }
      }

      pendingApplicants = pendingData.map((a) => ({
        id: a.id,
        applicant_id: a.applicant_id,
        legal_name: profileMap[a.applicant_id]?.legal_name ?? null,
        company_name: profileMap[a.applicant_id]?.company_name ?? null,
        job_title: profileMap[a.applicant_id]?.job_title ?? null,
        created_at: a.created_at,
      }))
    }
  }

  // Fetch creator public profile
  const { data: creatorProfileData } = await supabase.rpc('get_meeting_creator_public_profile', {
    p_meeting_id: id,
  })
  const creatorProfile = Array.isArray(creatorProfileData) ? creatorProfileData[0] : creatorProfileData

  const isLecture = meeting.meeting_type === 'lecture'

  return (
    <main className="iuna-page">
      <div className="iuna-content space-y-4 pb-20 lg:pb-4">

        {/* Header: type + status + title */}
        <section className="iuna-card-emphasis px-5 py-6 sm:px-7">
          <div className="flex items-center gap-2 mb-2">
            <span className="iuna-badge">
              {TYPE_LABEL[meeting.meeting_type ?? ''] ?? meeting.meeting_type}
            </span>
            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[meeting.status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
              {STATUS_LABEL[meeting.status] ?? meeting.status}
            </span>
            {meeting.regular_only && (
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                정회원 전용
              </span>
            )}
          </div>
          <h1 className="iuna-page-title mt-3">{meeting.title}</h1>

          {/* Key info */}
          <div className="mt-5 grid gap-3 text-sm text-[var(--iuna-muted)] sm:grid-cols-2">
            {(meeting.period_start || meeting.period_end) && (
              <p className="rounded-xl bg-[var(--iuna-warm)] p-3"><span className="block text-[11px]">기간</span><strong className="text-[var(--iuna-ink)]">{formatDate(meeting.period_start)}{meeting.period_end ? ` ~ ${formatDate(meeting.period_end)}` : ''}</strong></p>
            )}
            {meeting.capacity && <p className="rounded-xl bg-[var(--iuna-warm)] p-3"><span className="block text-[11px]">정원</span><strong className="text-[var(--iuna-ink)]">{meeting.capacity}명</strong></p>}
          </div>
        </section>

        {/* Creator */}
        {creatorProfile && (
          <section className="iuna-card px-5 py-4">
            <p className="text-xs text-slate-400 mb-2">개설자</p>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#DDDCD7] shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">{creatorProfile.legal_name ?? '이름 없음'}</p>
                {(creatorProfile.company_name || creatorProfile.job_title) && (
                  <p className="text-xs text-slate-500">
                    {[creatorProfile.company_name, creatorProfile.job_title].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Content sections */}
        <section className="iuna-card overflow-hidden">
          {meeting.description && (
            <div className="border-b border-[#E5E1DA] px-5 py-4">
              <h3 className="text-xs text-slate-400 mb-1">모임 소개</h3>
              <p className="text-sm whitespace-pre-wrap">{meeting.description}</p>
            </div>
          )}

          {meeting.goals && (
            <div className="border-b border-[#E5E1DA] px-5 py-4">
              <h3 className="text-xs text-slate-400 mb-1">목표</h3>
              <p className="text-sm whitespace-pre-wrap">{meeting.goals}</p>
            </div>
          )}

          {meeting.details && (
            <div className="border-b border-[#E5E1DA] px-5 py-4">
              <h3 className="text-xs text-slate-400 mb-1">상세내용</h3>
              <p className="text-sm whitespace-pre-wrap">{meeting.details}</p>
            </div>
          )}

          {meeting.meeting_type === 'project' && meeting.project_point_value && (
            <div className="border-b border-[#E5E1DA] px-5 py-4">
              <h3 className="text-xs text-slate-400 mb-1">프로젝트 포인트</h3>
              <p className="text-sm">완료 시 {meeting.project_point_value}점</p>
            </div>
          )}

          {meeting.support_request && (
            <div className="border-b border-[#E5E1DA] px-5 py-4">
              <h3 className="text-xs text-slate-400 mb-1">지원요청</h3>
              <p className="text-sm whitespace-pre-wrap">{meeting.support_request}</p>
            </div>
          )}

          {isLecture && meeting.lecture_fee != null && (
            <div className="border-b border-[#E5E1DA] px-5 py-4">
              <h3 className="text-xs text-slate-400 mb-1">강연료</h3>
              <p className="text-sm">{meeting.lecture_fee.toLocaleString()}원</p>
            </div>
          )}

          {isLecture && meeting.revenue_share_organizer != null && meeting.revenue_share_member != null && (
            <div className="border-b border-[#E5E1DA] px-5 py-4">
              <h3 className="text-xs text-slate-400 mb-1">수익배분</h3>
              <p className="text-sm">주최측 {meeting.revenue_share_organizer} : 강연자/회원 {meeting.revenue_share_member}</p>
            </div>
          )}

          {meeting.status === 'rejected' && meeting.rejection_reason && (
            <div className="px-5 py-4 bg-red-50">
              <h3 className="text-xs text-red-600 mb-1">반려 사유</h3>
              <p className="text-sm text-red-700 whitespace-pre-wrap">{meeting.rejection_reason}</p>
            </div>
          )}
        </section>

        {/* Lifecycle controls (creator only) */}
        <MeetingLifecycleClient
          meetingId={meeting.id}
          meetingStatus={meeting.status}
          isCreator={isCreator}
        />

        {/* Participants */}
        {((participants ?? []).length > 0 || (isCreator && pendingApplicants.length > 0)) && (
          <section className="iuna-card overflow-hidden">
            <div className="border-b border-[#E5E1DA] px-5 py-3">
              <h3 className="text-sm font-semibold">참여자 ({(participants ?? []).length}명)</h3>
            </div>
            <div className="px-5 py-3">
              {(participants ?? []).map((p: any) => (
                <div key={p.user_id} className="flex items-center gap-3 py-2">
                  <div className="w-7 h-7 rounded-full bg-[#DDDCD7] shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{p.legal_name ?? '이름 없음'}</p>
                    {(p.company_name || p.job_title) && (
                      <p className="text-xs text-slate-400 truncate">
                        {[p.company_name, p.job_title].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {isCreator && <PendingApplicantsClient applicants={pendingApplicants} />}
          </section>
        )}

        {/* Application section */}
        <MeetingApplicationClient
          meetingId={meeting.id}
          meetingStatus={meeting.status}
          meetingType={meeting.meeting_type}
          isCreator={isCreator}
          userGrade={auth.membership?.grade ?? ''}
          isOperator={auth.isOperator}
          myApplication={myApplication}
        />
      </div>
    </main>
  )
}
