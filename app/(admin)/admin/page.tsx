import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '../../../lib/supabase/server'
import { getCurrentMemberAuth } from '../../../lib/supabase/auth'
import Link from 'next/link'

export default async function AdminDashboard() {
  const auth = await getCurrentMemberAuth()

  if (!auth.session?.user) {
    redirect('/login')
  }

  if (!auth.isOperator) {
    redirect('/home')
  }

  const supabase = await createServerSupabaseClient()

  const canManageMembers =
    auth.isSuperAdmin || auth.activeRoles.some((r) => r.code === 'member_admin')
  const canManageMeetings =
    auth.isSuperAdmin || auth.activeRoles.some((r) => r.code === 'meeting_admin')

  // Determine role label
  const roleLabel = auth.isSuperAdmin
    ? '슈퍼 운영진'
    : auth.activeRoles.find((r) => r.code === 'meeting_admin')
    ? '모임 관리 운영진'
    : auth.activeRoles.find((r) => r.code === 'member_admin')
    ? '회원 관리 운영진'
    : '일반 운영진'

  // Member metrics
  let totalMembersCount: number | null = null
  let associateCount: number | null = null
  let regularCount: number | null = null
  let dormantCount: number | null = null
  let eligibleCount = 0

  if (canManageMembers) {
    try {
      const totalRes = await supabase
        .from('memberships')
        .select('user_id', { count: 'exact', head: true })
      if (!totalRes.error) totalMembersCount = totalRes.count ?? 0

      const associateRes = await supabase
        .from('memberships')
        .select('user_id', { count: 'exact', head: true })
        .eq('grade', 'associate')
      if (!associateRes.error) associateCount = associateRes.count ?? 0

      const regularRes = await supabase
        .from('memberships')
        .select('user_id', { count: 'exact', head: true })
        .eq('grade', 'regular')
      if (!regularRes.error) regularCount = regularRes.count ?? 0

      const dormantRes = await supabase
        .from('memberships')
        .select('user_id', { count: 'exact', head: true })
        .eq('status', 'dormant')
      if (!dormantRes.error) dormantCount = dormantRes.count ?? 0

      const pointRes = await supabase.rpc('get_associate_point_totals')
      if (!pointRes.error && pointRes.data) {
        eligibleCount = (pointRes.data as Array<{ total_points: number }>).filter(
          (p) => p.total_points >= 5
        ).length
      }
    } catch (e) {
      console.error('[admin-dashboard] member-metrics error:', e)
    }
  }

  // Meeting metrics
  let pendingCount = 0
  let recruitingCount = 0
  let activeCount = 0

  if (canManageMeetings) {
    try {
      const pendingRes = await supabase
        .from('meetings')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending_approval')
      if (!pendingRes.error) pendingCount = pendingRes.count ?? 0

      const recruitingRes = await supabase
        .from('meetings')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'recruiting')
      if (!recruitingRes.error) recruitingCount = recruitingRes.count ?? 0

      const activeRes = await supabase
        .from('meetings')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
      if (!activeRes.error) activeCount = activeRes.count ?? 0
    } catch (e) {
      console.error('[admin-dashboard] meeting-metrics error:', e)
    }
  }

  return (
    <main className="iuna-page">
      <div className="iuna-container space-y-6">

        {/* Header */}
        <div>
          <p className="iuna-eyebrow">{roleLabel}</p>
          <h1 className="iuna-page-title mt-1">관리 홈</h1>
        </div>

        {/* Permission summary */}
        <section className="iuna-card overflow-hidden">
          <div className="border-b border-[#E5E1DA] px-4 py-3">
            <h2 className="text-sm font-semibold">내 관리 권한</h2>
          </div>
          <div className="px-4 py-3 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">회원 정보 전체 조회</span><span className="font-medium">가능</span></div>
            <div className="flex justify-between"><span className="text-slate-500">회원 등급 변경</span><span className="font-medium">{canManageMembers ? '가능' : '불가'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">모임 승인</span><span className="font-medium">{canManageMeetings ? '가능' : '불가'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">운영진 역할 부여</span><span className="font-medium">{auth.isSuperAdmin ? '가능' : '불가'}</span></div>
          </div>
        </section>

        {/* Metrics */}
        {canManageMembers && (
          <section className="iuna-card-emphasis px-5 py-5">
            <h2 className="text-xs text-slate-400 mb-2">회원 현황</h2>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div><p className="text-lg font-bold">{totalMembersCount ?? '-'}</p><p className="text-[11px] text-slate-500">총 회원</p></div>
              <div><p className="text-lg font-bold">{associateCount ?? '-'}</p><p className="text-[11px] text-slate-500">준회원</p></div>
              <div><p className="text-lg font-bold">{regularCount ?? '-'}</p><p className="text-[11px] text-slate-500">정회원</p></div>
              <div><p className="text-lg font-bold">{dormantCount ?? '-'}</p><p className="text-[11px] text-slate-500">휴면</p></div>
            </div>
          </section>
        )}

        {canManageMeetings && (
          <section className="iuna-card-emphasis px-5 py-5">
            <h2 className="text-xs text-slate-400 mb-2">모임 현황</h2>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><p className="text-lg font-bold">{pendingCount}</p><p className="text-[11px] text-slate-500">승인대기</p></div>
              <div><p className="text-lg font-bold">{recruitingCount}</p><p className="text-[11px] text-slate-500">모집중</p></div>
              <div><p className="text-lg font-bold">{activeCount}</p><p className="text-[11px] text-slate-500">활동중</p></div>
            </div>
          </section>
        )}

        {/* Pending actions */}
        {(pendingCount > 0 || eligibleCount > 0) && (
          <section className="space-y-2">
            <h2 className="text-xs text-slate-400">대기 중 항목</h2>
            {canManageMeetings && pendingCount > 0 && (
              <Link href="/admin/meetings" className="flex items-center justify-between rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 transition hover:border-amber-300">
                <div>
                  <p className="text-sm font-medium text-amber-800">모임 승인 대기</p>
                  <p className="text-lg font-bold text-amber-900">{pendingCount}건</p>
                </div>
                <span className="text-amber-400">→</span>
              </Link>
            )}
            {canManageMembers && eligibleCount > 0 && (
              <Link href="/admin/members" className="flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 transition hover:border-emerald-300">
                <div>
                  <p className="text-sm font-medium text-emerald-800">승급 대상 회원</p>
                  <p className="text-lg font-bold text-emerald-900">{eligibleCount}명</p>
                </div>
                <span className="text-emerald-400">→</span>
              </Link>
            )}
          </section>
        )}

        {/* Shortcuts */}
        <section className="space-y-2">
          <h2 className="text-xs text-slate-400">바로가기</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Link href="/admin/members" className="iuna-card-emphasis min-h-28 p-5 text-sm font-bold transition hover:border-[var(--iuna-navy-2)]">
              회원 조회 →
            </Link>
            {canManageMeetings && (
              <Link href="/admin/meetings" className="iuna-card-emphasis min-h-28 p-5 text-sm font-bold transition hover:border-[var(--iuna-navy-2)]">
                모임 승인 →
              </Link>
            )}
          </div>
        </section>

      </div>
    </main>
  )
}
