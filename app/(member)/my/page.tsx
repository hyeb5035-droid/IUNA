import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '../../../lib/supabase/server'
import { getCurrentMemberAuth } from '../../../lib/supabase/auth'

const GRADE_LABEL: Record<string, string> = {
  associate: '준회원',
  regular: '정회원',
  honorary: '명예회원',
}

const STATUS_LABEL: Record<string, string> = {
  active: '활동',
  dormant: '휴면',
  withdrawn: '탈퇴',
  expelled: '제명',
}

function formatDate(value: string | null | undefined) {
  if (!value) return null
  return new Date(value).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function Empty() {
  return <span className="text-slate-400">등록된 정보가 없습니다.</span>
}

export default async function MemberMyPage() {
  const supabase = await createServerSupabaseClient()

  const { data: sessionData } = await supabase.auth.getSession()
  const user = sessionData?.session?.user ?? null

  if (!user) {
    redirect('/login')
  }

  const userId = user.id

  const [profileRes, privateRes, membershipRes, historyRes, rolesRes, meetingsRes, applicationsRes, participationsRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('member_no, company_name, job_title, introduction, interests, created_at')
      .eq('id', userId)
      .single(),
    supabase
      .from('profile_private')
      .select('legal_name')
      .eq('user_id', userId)
      .single(),
    supabase
      .from('memberships')
      .select('grade, status')
      .eq('user_id', userId)
      .single(),
    supabase
      .from('member_number_history')
      .select('member_no, number_band, valid_from, valid_to, change_reason')
      .eq('user_id', userId)
      .order('valid_from', { ascending: false }),
    supabase
      .from('member_roles')
      .select('revoked_at, expires_at, roles(code, name)')
      .eq('user_id', userId),
    supabase
      .from('meetings')
      .select('id, meeting_type, title, status, period_start, period_end, created_by')
      .eq('created_by', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase
      .from('meeting_applications')
      .select('id, meeting_id, status, created_at')
      .eq('applicant_id', userId)
      .order('created_at', { ascending: false }),
    supabase
      .from('meeting_applications')
      .select('id, meeting_id, application_type, completed')
      .eq('applicant_id', userId)
      .eq('status', 'approved'),
  ])

  const profile = profileRes.data
  const priv = privateRes.data
  const membership = membershipRes.data
  const history = historyRes.data ?? []
  const roleRows = Array.isArray(rolesRes.data) ? rolesRes.data : []
  const isOperator = roleRows.some(
    (r) => r.revoked_at === null && (!r.expires_at || new Date(r.expires_at) > new Date()),
  )

  // Meeting history data
  const myCreatedMeetings = meetingsRes.data ?? []
  const applications = applicationsRes.data ?? []
  const participations = participationsRes.data ?? []
  
  // Get all meeting IDs the user has applied to or participates in
  const relatedMeetingIds = [
    ...applications.map((a) => a.meeting_id),
    ...participations.map((p) => p.meeting_id),
  ]
  
  // Fetch those meetings
  let relatedMeetings: typeof myCreatedMeetings = []
  if (relatedMeetingIds.length > 0) {
    const { data } = await supabase
      .from('meetings')
      .select('id, meeting_type, title, status, period_start, period_end, created_by')
      .in('id', [...new Set(relatedMeetingIds)])
      .is('deleted_at', null)
    relatedMeetings = data ?? []
  }
  
  // Combine all meetings for the map
  const allMeetings = [...myCreatedMeetings, ...relatedMeetings]
  const meetingsById = new Map(allMeetings.map((m) => [m.id, m]))

  // Fetch point total for associate members
  let pointTotal: number | null = null
  if (membership?.grade === 'associate') {
    const { data: ptData } = await supabase.rpc('get_my_point_total')
    pointTotal = typeof ptData === 'number' ? ptData : 0
  }

  if (!profile || !membership) {
    return (
      <main className="min-h-screen bg-[#F5F4F1] px-6 py-16 text-[#111111]">
        <div className="mx-auto max-w-3xl rounded-3xl bg-white border border-[#DDDCD7] p-10 shadow-sm">
          <h1 className="text-3xl font-semibold">내 정보</h1>
          <p className="mt-6 text-slate-500">회원 정보를 불러올 수 없습니다. 관리자에게 문의해주세요.</p>
        </div>
      </main>
    )
  }

  const interests: string[] = Array.isArray(profile.interests) ? profile.interests : []

  return (
    <main className="iuna-page">
      <div className="iuna-content space-y-5">

        {/* Header */}
        <div>
          <p className="iuna-eyebrow">내 계정</p>
          <h1 className="iuna-page-title mt-1">마이페이지</h1>
        </div>

        <section className="iuna-card-emphasis flex items-center gap-4 p-5 sm:p-6">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--iuna-navy-100)] text-xl font-bold text-[var(--iuna-navy)]">
            {(priv?.legal_name ?? profile.member_no).slice(0, 1)}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold">{priv?.legal_name ?? '회원'}</h2>
            <p className="mt-1 text-sm text-[var(--iuna-muted)]">{GRADE_LABEL[membership.grade] ?? membership.grade} · 회원번호 {profile.member_no}</p>
          </div>
          <div className="ml-auto"><StatusBadge status={membership.status} /></div>
        </section>

        {/* 1. 회원 기본 정보 */}
        <section className="iuna-card overflow-hidden">
          <div className="border-b border-[#E5E1DA] px-4 py-3">
            <h2 className="text-sm font-semibold">회원 기본 정보</h2>
          </div>
          <div className="px-4 py-3 space-y-2">
            <Row label="이름" value={priv?.legal_name ?? null} />
            <Row label="회원번호">
              <span className="font-mono text-sm font-semibold tracking-wider">
                {profile.member_no}
              </span>
            </Row>
            <Row label="등급">
              {isOperator ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="rounded-full bg-[#111111] px-2 py-0.5 text-xs font-medium text-white">운영진</span>
                  <span className="text-xs text-slate-400">{GRADE_LABEL[membership.grade] ?? membership.grade}</span>
                </span>
              ) : (
                <span>{GRADE_LABEL[membership.grade] ?? membership.grade}</span>
              )}
            </Row>
            <Row label="상태">
              <StatusBadge status={membership.status} />
            </Row>
            <Row label="가입일" value={formatDate(profile.created_at)} />
            {pointTotal !== null && membership.grade === 'associate' && (
              <Row label="포인트">
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-sm font-semibold">{pointTotal}점</span>
                  {pointTotal >= 5 && (
                    <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs font-medium text-emerald-700">승급 대상</span>
                  )}
                </span>
              </Row>
            )}
          </div>
        </section>

        {/* 2. 프로필 */}
        <section className="iuna-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#E5E1DA] px-4 py-3">
            <h2 className="text-sm font-semibold">프로필</h2>
            <a href="/my/edit" className="text-xs text-slate-500 hover:text-[#111111]">
              수정 →
            </a>
          </div>
          <div className="px-4 py-3 space-y-2">
            <Row label="소속" value={profile.company_name} />
            <Row label="직무" value={profile.job_title} />
            <Row label="자기소개" value={profile.introduction} />
            <Row label="관심사">
              {interests.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {interests.map((tag) => (
                    <span key={tag} className="rounded-full bg-[#F5F4F1] px-2.5 py-0.5 text-xs">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : (
                <Empty />
              )}
            </Row>
          </div>
        </section>

        {/* 3. 내가 개설한 모임 */}
        <section className="iuna-card overflow-hidden">
          <div className="border-b border-[#E5E1DA] px-4 py-3">
            <h2 className="text-sm font-semibold">내가 개설한 모임</h2>
          </div>
          {myCreatedMeetings.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-400 text-center">개설한 모임이 없습니다.</p>
          ) : (
            <div>
              {myCreatedMeetings.map((meeting) => (
                <MeetingCard key={meeting.id} meeting={meeting} />
              ))}
            </div>
          )}
        </section>

        {/* 4. 신청/참여 모임 */}
        <section className="iuna-card overflow-hidden">
          <div className="border-b border-[#E5E1DA] px-4 py-3">
            <h2 className="text-sm font-semibold">신청/참여 모임</h2>
          </div>
          {(() => {
            if (applications.length === 0 && participations.length === 0) {
              return <p className="px-4 py-6 text-sm text-slate-400 text-center">신청하거나 참여한 모임이 없습니다.</p>
            }
            const items = [
              ...applications.map((a) => ({
                meeting: meetingsById.get(a.meeting_id),
                status: a.status,
                role: 'application',
              })),
              ...participations.map((p) => ({
                meeting: meetingsById.get(p.meeting_id),
                status: p.completed ? 'completed' : 'participating',
                role: 'participant',
              })),
            ].filter((item) => item.meeting)
            if (items.length === 0) {
              return <p className="px-4 py-6 text-sm text-slate-400 text-center">신청하거나 참여한 모임이 없습니다.</p>
            }
            return (
              <div>
                {items.map((item, i) => (
                  <ApplicationCard
                    key={i}
                    meeting={item.meeting!}
                    status={item.status}
                    role={item.role}
                  />
                ))}
              </div>
            )
          })()}
        </section>

        {/* 5. 회원번호 이력 */}
        <section className="iuna-card overflow-hidden">
          <div className="border-b border-[#E5E1DA] px-4 py-3">
            <h2 className="text-sm font-semibold">회원번호 이력</h2>
          </div>
          {history.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-400 text-center">이력이 없습니다.</p>
          ) : (
            <div>
              {history.map((entry, i) => {
                const isCurrent = entry.valid_to === null
                return (
                  <div
                    key={i}
                    className={`flex items-center justify-between px-4 py-3 text-sm border-b border-[#E5E1DA] last:border-b-0 ${
                      isCurrent ? 'bg-[#F5F4F1]' : 'text-slate-500'
                    }`}
                  >
                    <span className="font-mono font-semibold tracking-wider">
                      {entry.member_no}
                    </span>
                    <span className="text-xs text-slate-400">
                      {isCurrent ? '현재' : formatDate(entry.valid_from)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <a
          href="/account/password"
          className="iuna-secondary w-full"
        >
          비밀번호 변경
        </a>

        {/* 6. 로그아웃 */}
        <a
          href="/auth/logout"
          className="iuna-secondary w-full text-[var(--iuna-muted)]"
        >
          로그아웃
        </a>

      </div>
    </main>
  )
}

function Row({
  label,
  value,
  children,
}: {
  label: string
  value?: string | null
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-right">
        {children ?? (value ? value : <Empty />)}
      </span>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABEL[status] ?? status
  const colour =
    status === 'active'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : status === 'dormant'
      ? 'bg-yellow-50 text-yellow-700 border-yellow-200'
      : 'bg-red-50 text-red-700 border-red-200'
  return (
    <span className={`inline-flex rounded-full border px-3 py-0.5 text-xs font-medium ${colour}`}>
      {label}
    </span>
  )
}

const MEETING_TYPE_LABEL: Record<string, string> = {
  study: '스터디',
  lecture: '강의',
  project: '프로젝트',
  networking: '네트워킹',
  lightning: '라이트닝',
  regular_networking: '정기 네트워킹',
}

const MEETING_STATUS_LABEL: Record<string, string> = {
  pending_approval: '승인대기',
  recruiting: '모집중',
  active: '활동중',
  ended: '종료',
  rejected: '반려',
  cancelled: '취소',
}

const APPLICATION_STATUS_LABEL: Record<string, string> = {
  pending: '승인대기',
  approved: '승인',
  rejected: '반려',
  cancelled: '취소',
  completed: '완료',
  participating: '참여중',
}

type MeetingData = {
  id: string
  meeting_type: string
  title: string
  status: string
  period_start: string | null
  period_end: string | null
}

function MeetingCard({ meeting }: { meeting: MeetingData }) {
  return (
    <a
      href={`/meetings/${meeting.id}`}
      className="flex items-center justify-between border-b border-[#E5E1DA] px-4 py-3 text-sm last:border-b-0 transition hover:bg-[#F5F4F1]"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="rounded-full bg-[#F5F4F1] px-2 py-0.5 text-xs shrink-0">
          {MEETING_TYPE_LABEL[meeting.meeting_type] ?? meeting.meeting_type}
        </span>
        <span className="truncate font-medium">{meeting.title}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={`text-xs ${meeting.status === 'ended' ? 'text-slate-400' : 'text-slate-500'}`}>
          {MEETING_STATUS_LABEL[meeting.status] ?? meeting.status}
        </span>
        <span className="text-slate-300">→</span>
      </div>
    </a>
  )
}

function ApplicationCard({
  meeting,
  status,
  role,
}: {
  meeting: MeetingData
  status: string
  role: string
}) {
  const statusLabel = role === 'application'
    ? (APPLICATION_STATUS_LABEL[status] ?? status)
    : (APPLICATION_STATUS_LABEL[status] ?? status)

  const statusColor =
    status === 'approved' || status === 'participating'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : status === 'pending'
      ? 'bg-yellow-50 text-yellow-700 border-yellow-200'
      : status === 'rejected' || status === 'cancelled'
      ? 'bg-red-50 text-red-700 border-red-200'
      : status === 'completed'
      ? 'bg-blue-50 text-blue-700 border-blue-200'
      : 'bg-slate-50 text-slate-700 border-slate-200'

  return (
    <a
      href={`/meetings/${meeting.id}`}
      className="flex items-center justify-between border-b border-[#E5E1DA] px-4 py-3 text-sm last:border-b-0 transition hover:bg-[#F5F4F1]"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="rounded-full bg-[#F5F4F1] px-2 py-0.5 text-xs shrink-0">
          {MEETING_TYPE_LABEL[meeting.meeting_type] ?? meeting.meeting_type}
        </span>
        <span className="truncate font-medium">{meeting.title}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={`rounded-full border px-2 py-0.5 text-xs ${statusColor}`}>
          {statusLabel}
        </span>
        <span className="text-slate-300">→</span>
      </div>
    </a>
  )
}
