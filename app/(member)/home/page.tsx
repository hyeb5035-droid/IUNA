import Link from 'next/link'
import { createServerSupabaseClient } from '../../../lib/supabase/server'
import { getCurrentMemberAuth } from '../../../lib/supabase/auth'

const GRADE_LABEL: Record<string, string> = {
  associate: '준회원',
  regular: '정회원',
  honorary: '명예회원',
}

export default async function MemberHomePage() {
  const auth = await getCurrentMemberAuth()
  const supabase = await createServerSupabaseClient()

  const memberName = auth.profile?.nickname || auth.profile?.member_no || '회원'
  const memberNo = auth.profile?.member_no ?? ''
  const isOperator = auth.isOperator
  const isSuperAdmin = auth.isSuperAdmin
  const canManageMembers = isSuperAdmin || auth.activeRoles.some((r) => r.code === 'member_admin')
  const canManageMeetings = isSuperAdmin || auth.activeRoles.some((r) => r.code === 'meeting_admin')
  const membershipGrade = auth.membership?.grade

  // Determine if user can create meetings (same logic as /meetings/new)
  let canCreateMeeting = false
  if (auth.session?.user) {
    const userId = auth.session.user.id
    const { data: membership } = await supabase
      .from('memberships')
      .select('grade')
      .eq('user_id', userId)
      .single()

    const { data: roles } = await supabase
      .from('member_roles')
      .select('revoked_at, expires_at')
      .eq('user_id', userId)

    const hasActiveRole = (roles ?? []).some(
      (r) => r.revoked_at === null && (!r.expires_at || new Date(r.expires_at) > new Date()),
    )

    canCreateMeeting = membership?.grade !== 'associate' || hasActiveRole
  }

  // Get counts for summary
  let createdMeetingsCount = 0
  let appliedMeetingsCount = 0

  if (auth.session?.user) {
    const userId = auth.session.user.id

    const [createdRes, appliedRes] = await Promise.all([
      supabase
        .from('meetings')
        .select('id', { count: 'exact', head: true })
        .eq('created_by', userId)
        .is('deleted_at', null),
      supabase
        .from('meeting_applications')
        .select('id', { count: 'exact', head: true })
        .eq('applicant_id', userId),
    ])

    createdMeetingsCount = createdRes.count ?? 0
    appliedMeetingsCount = appliedRes.count ?? 0
  }

  // Get current activity (recruiting/active meetings user created or participates in)
  let currentActivity: Array<{ id: string; title: string; status: string; meeting_type: string }> = []

  if (auth.session?.user) {
    const userId = auth.session.user.id

    // Get meetings user created that are active or recruiting
    const { data: myCreated } = await supabase
      .from('meetings')
      .select('id, title, status, meeting_type')
      .eq('created_by', userId)
      .in('status', ['recruiting', 'active'])
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(3)

    // Get meetings user participates in
    const { data: myParticipations } = await supabase
      .from('meeting_applications')
      .select('meeting_id, status')
      .eq('applicant_id', userId)
      .eq('status', 'approved')

    let relatedMeetingIds: string[] = []
    if (myParticipations) {
      relatedMeetingIds = myParticipations.map((p) => p.meeting_id)
    }

    const { data: participatedMeetings } = relatedMeetingIds.length > 0
      ? await supabase
          .from('meetings')
          .select('id, title, status, meeting_type')
          .in('id', relatedMeetingIds)
          .in('status', ['recruiting', 'active'])
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(3)
      : { data: null }

    // Combine and deduplicate
    const combined = [...(myCreated ?? []), ...(participatedMeetings ?? [])]
    const seen = new Set<string>()
    currentActivity = combined.filter((m) => {
      if (seen.has(m.id)) return false
      seen.add(m.id)
      return true
    }).slice(0, 3)
  }

  const MEETING_TYPE_LABEL: Record<string, string> = {
    study: '스터디',
    lecture: '강의',
    project: '프로젝트',
    networking: '네트워킹',
    lightning: '라이트닝',
    regular_networking: '정기 네트워킹',
  }

  const STATUS_LABEL: Record<string, string> = {
    recruiting: '모집중',
    active: '활동중',
  }

  // Build membership metadata string
  const membershipMeta = []
  if (membershipGrade && GRADE_LABEL[membershipGrade]) {
    membershipMeta.push(GRADE_LABEL[membershipGrade])
  }
  if (isOperator) {
    membershipMeta.push('운영진')
  }
  if (memberNo) {
    membershipMeta.push(`#${memberNo}`)
  }
  const metaString = membershipMeta.join(' · ')

  const isAssociate = membershipGrade === 'associate'
  const isRegular = membershipGrade === 'regular'

  // Get points for associate members
  let pointTotal: number | null = null
  let pointsNeededForPromotion: number | null = null
  if (isAssociate && auth.session?.user) {
    const { data } = await supabase.rpc('get_my_point_total')
    pointTotal = typeof data === 'number' ? data : 0
    pointsNeededForPromotion = pointTotal >= 5 ? 0 : 5 - pointTotal
  }

  return (
    <main className="iuna-page">
      <div className="iuna-container space-y-8">

        {/* Welcome header - name is primary, metadata is secondary */}
        <section className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
          <header className="rounded-[18px] bg-gradient-to-br from-[var(--iuna-navy)] to-[#0A4D78] p-7 text-white sm:p-8">
            {metaString && <p className="text-xs font-semibold tracking-wide text-[#BFD6E4]">{metaString}</p>}
            <h1 className="mt-3 text-[28px] font-bold leading-tight sm:text-[30px]">안녕하세요, {memberName}님.</h1>
            <p className="mt-2 text-sm text-[#D9E8F0]">함께 배우고 성장할 활동을 찾아보세요.</p>
          </header>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <Link
              href="/meetings"
              className="iuna-card-emphasis group flex min-h-28 items-center gap-4 p-5 transition hover:border-[var(--iuna-navy-2)]"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--iuna-navy-100)]">
                <svg className="h-5 w-5 text-[var(--iuna-navy)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <div><h3 className="font-bold">모임 둘러보기</h3>
              <p className="mt-1 text-xs text-[var(--iuna-muted)]">
                새로운 스터디, 프로젝트와 모임을 찾아보세요.
              </p></div>
            </Link>

            {canCreateMeeting && (
              <Link
                href="/meetings/new"
                className="iuna-card-emphasis group flex min-h-28 items-center gap-4 p-5 transition hover:border-[var(--iuna-navy-2)]"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--iuna-navy-100)]">
                  <svg className="h-5 w-5 text-[var(--iuna-navy)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <div><h3 className="font-bold">모임 개설하기</h3>
                <p className="mt-1 text-xs text-[var(--iuna-muted)]">
                  함께하고 싶은 활동을 직접 시작해보세요.
                </p></div>
              </Link>
            )}
          </div>
        </section>

        {/* My activity summary - 나의 IUNA */}
        <section>
          <h2 className="iuna-section-title mb-3">내 활동 요약</h2>
          {isAssociate ? (
            // Associate member: show points and promotion info
            <div className="iuna-card grid grid-cols-1 divide-y divide-[var(--iuna-line)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <div className="p-5">
                <p className="text-xs text-slate-500">신청/참여 모임</p>
                <p className="mt-1 text-xl font-semibold">{appliedMeetingsCount}</p>
              </div>
              <div className="p-5">
                <p className="text-xs text-slate-500">보유 포인트</p>
                <p className="mt-1 text-xl font-semibold">{pointTotal ?? 0}점</p>
              </div>
              <div className="p-5">
                <p className="text-xs text-slate-500">정회원 승급</p>
                <p className="mt-1 text-xl font-semibold">
                  {pointsNeededForPromotion === 0 ? '가능' : `${pointsNeededForPromotion}점 남음`}
                </p>
              </div>
            </div>
          ) : (
            // Regular/operator member
            <div className="iuna-card grid grid-cols-2 divide-x divide-[var(--iuna-line)]">
              <div className="p-5">
                <p className="text-xs text-slate-500">개설한 모임</p>
                <p className="mt-1 text-xl font-semibold">{createdMeetingsCount}</p>
              </div>
              <div className="p-5">
                <p className="text-xs text-slate-500">신청/참여 모임</p>
                <p className="mt-1 text-xl font-semibold">{appliedMeetingsCount}</p>
              </div>
            </div>
          )}
        </section>

        {/* Recruiting meetings */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="iuna-section-title">모집중인 모임</h2>
            <Link href="/meetings" className="text-xs font-semibold text-[var(--iuna-navy)] transition hover:underline">
              전체보기 →
            </Link>
          </div>
          {currentActivity.length > 0 ? (
            <div className="iuna-card overflow-hidden">
              {currentActivity.map((meeting) => (
                <Link
                  key={meeting.id}
                  href={`/meetings/${meeting.id}`}
                  className="flex items-center justify-between border-b border-[var(--iuna-line)] px-4 py-4 text-sm last:border-b-0 transition hover:bg-[var(--iuna-warm)]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="iuna-badge shrink-0">
                      {MEETING_TYPE_LABEL[meeting.meeting_type] ?? meeting.meeting_type}
                    </span>
                    <span className="truncate font-medium">{meeting.title}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="iuna-badge iuna-badge-success">
                      모집중
                    </span>
                    <span className="text-slate-300">→</span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="iuna-card p-8 text-center">
              <p className="text-sm text-slate-500">현재 참여 중인 활동이 없습니다.</p>
              <Link href="/meetings" className="mt-2 inline-block text-sm font-medium text-[#111111] hover:underline">
                새로운 모임을 둘러보세요 →
              </Link>
            </div>
          )}
        </section>

        

      </div>
    </main>
  )
}
