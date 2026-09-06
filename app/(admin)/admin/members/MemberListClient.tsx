'use client'

import { useMemo, useState } from 'react'
import type { MemberRow } from './page'

const ROLES = [
  { code: 'operator', label: '일반 운영진' },
  { code: 'member_admin', label: '회원 관리' },
  { code: 'meeting_admin', label: '모임 관리' },
  { code: 'super_admin', label: '슈퍼 운영진' },
] as const
const GRADE_LABEL: Record<string, string> = { associate: '준회원', regular: '정회원', honorary: '명예회원' }
const STATUS_LABEL: Record<string, string> = { active: '활동', dormant: '휴면', withdrawn: '탈퇴', expelled: '제명' }

type MemberDetail = {
  id: string
  member_no: string
  legal_name: string | null
  grade: string
  status: string
  joined_at: string
  birth_date: string | null
  gender: string | null
  email: string | null
  nickname: string | null
  company_name: string | null
  job_title: string | null
  introduction: string | null
  interests: string[]
  total_points: number
  active_roles: Array<{ code: string; name: string }>
  member_number_history: Array<{ member_no: string; number_band: string; valid_from: string; valid_to: string | null; change_reason: string }>
}

type Props = { members: MemberRow[]; canManageMembers: boolean; isSuperAdmin: boolean }

function value(value: string | null | undefined) {
  return value?.trim() || '등록된 정보가 없습니다.'
}

function date(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString('ko-KR') : '등록된 정보가 없습니다.'
}

export default function MemberListClient({ members: initial, canManageMembers, isSuperAdmin }: Props) {
  const [members, setMembers] = useState(initial)
  const [query, setQuery] = useState('')
  const [roleTarget, setRoleTarget] = useState<MemberRow | null>(null)
  const [selectedRoles, setSelectedRoles] = useState<string[]>([])
  const [roleStatus, setRoleStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [roleMessage, setRoleMessage] = useState('')
  const [detail, setDetail] = useState<MemberDetail | null>(null)
  const [detailStatus, setDetailStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [promoteTarget, setPromoteTarget] = useState<MemberRow | null>(null)
  const [promoteReason, setPromoteReason] = useState('')
  const [promoteMessage, setPromoteMessage] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return members.filter((member) => !q || member.member_no.includes(q) || (member.legal_name ?? '').toLowerCase().includes(q))
  }, [members, query])

  async function refreshMembers() {
    const response = await fetch('/api/admin/members', { cache: 'no-store' })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || '회원 목록 갱신에 실패했습니다.')
    setMembers(body.members)
  }

  function openRoles(member: MemberRow) {
    setRoleTarget(member)
    setSelectedRoles(member.activeRoles.map((role) => role.code))
    setRoleStatus('idle')
    setRoleMessage('')
  }

  async function saveRoles() {
    if (!roleTarget) return
    setRoleStatus('loading')
    setRoleMessage('')
    const current = new Set(roleTarget.activeRoles.map((role) => role.code))
    const wanted = new Set(selectedRoles)
    const actions = [
      ...ROLES.filter((role) => wanted.has(role.code) && !current.has(role.code)).map((role) => ({ action: 'assign', role_code: role.code })),
      ...ROLES.filter((role) => current.has(role.code) && !wanted.has(role.code)).map((role) => ({ action: 'revoke', role_code: role.code })),
    ]
    try {
      for (const action of actions) {
        const response = await fetch('/api/admin/roles', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...action, user_id: roleTarget.id }),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error || '역할 변경에 실패했습니다.')
      }
      await refreshMembers()
      setRoleTarget(null)
    } catch (error) {
      setRoleStatus('error')
      setRoleMessage(error instanceof Error ? error.message : '역할 변경에 실패했습니다.')
    }
  }

  async function openDetail(member: MemberRow) {
    setDetail(null)
    setDetailStatus('loading')
    const response = await fetch(`/api/admin/members/${member.id}`, { cache: 'no-store' })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      setDetailStatus('error')
      setRoleMessage(body.error || '회원 정보를 불러오지 못했습니다.')
      return
    }
    setDetail(body.member)
    setDetailStatus('idle')
  }

  async function promote() {
    if (!promoteTarget || !promoteReason.trim()) return
    setPromoteMessage('처리 중...')
    const response = await fetch('/api/admin/promote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: promoteTarget.id, reason: promoteReason.trim() }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      setPromoteMessage(body.error || '승급 처리에 실패했습니다.')
      return
    }
    await refreshMembers()
    setPromoteTarget(null)
    setPromoteReason('')
    setPromoteMessage('')
  }

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-[#E5E1DA] bg-white">
        <div className="border-b border-[#DDDCD7] p-5">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="회원번호 또는 이름 검색" className="w-full rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] px-4 py-2.5 text-sm outline-none" />
        </div>
        <div className="divide-y divide-[#DDDCD7]">
          {filtered.map((member) => (
            <article key={member.id} className="grid gap-3 p-5 sm:grid-cols-[1fr_auto] sm:items-center">
              <button onClick={() => openDetail(member)} className="min-w-0 text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{value(member.legal_name)}</span>
                  <span className="font-mono text-xs text-slate-500">{member.member_no}</span>
                  <span className="text-xs text-slate-500">{GRADE_LABEL[member.grade] ?? member.grade} · {STATUS_LABEL[member.status] ?? member.status}</span>
                </div>
                {member.activeRoles.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {member.activeRoles.map((role) => <span key={role.code} className="rounded-full bg-slate-900 px-2.5 py-1 text-xs text-white">{ROLES.find((item) => item.code === role.code)?.label ?? role.name}</span>)}
                  </div>
                )}
                {member.points !== null && <p className="mt-2 text-xs text-slate-500">포인트 {member.points}점 {member.points >= 5 ? '· 승급 대상' : ''}</p>}
              </button>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => openDetail(member)} className="rounded-lg border border-[#DDDCD7] px-3 py-2 text-xs font-medium">상세 보기</button>
                {isSuperAdmin && member.grade === 'regular' && member.status === 'active' && (
                  <button onClick={() => openRoles(member)} className="rounded-lg bg-[#0A0A0A] px-3 py-2 text-xs font-medium text-white">{member.isOperator ? '역할 관리' : '운영진 지정'}</button>
                )}
                {canManageMembers && member.grade === 'associate' && member.status === 'active' && (
                  <button onClick={() => { setPromoteTarget(member); setPromoteMessage('') }} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white">정회원 승급</button>
                )}
              </div>
            </article>
          ))}
          {filtered.length === 0 && <p className="p-10 text-center text-sm text-slate-400">검색 결과가 없습니다.</p>}
        </div>
      </section>

      {roleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-xl">
            <h2 className="text-lg font-semibold">{roleTarget.isOperator ? '역할 관리' : '운영진 지정'}</h2>
            <p className="mt-1 text-sm text-slate-500">{value(roleTarget.legal_name)} · 선택된 역할이 현재 적용될 역할입니다.</p>
            <div className="mt-5 space-y-2">
              {ROLES.map((role) => (
                <label key={role.code} className="flex items-center gap-3 rounded-xl border border-[#DDDCD7] p-3 text-sm">
                  <input type="checkbox" checked={selectedRoles.includes(role.code)} disabled={roleStatus === 'loading'} onChange={(event) => setSelectedRoles((prev) => event.target.checked ? [...prev, role.code] : prev.filter((code) => code !== role.code))} />
                  {role.label}
                </label>
              ))}
            </div>
            {roleStatus === 'error' && <p className="mt-3 text-sm text-red-600">{roleMessage}</p>}
            <div className="mt-6 flex gap-2">
              <button onClick={saveRoles} disabled={roleStatus === 'loading'} className="flex-1 rounded-xl bg-black px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{roleStatus === 'loading' ? '저장 중...' : '저장'}</button>
              <button onClick={() => setRoleTarget(null)} disabled={roleStatus === 'loading'} className="flex-1 rounded-xl border px-4 py-3 text-sm">취소</button>
            </div>
          </div>
        </div>
      )}

      {(detailStatus !== 'idle' || detail) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="max-h-full w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-6 shadow-xl sm:p-8">
            {detailStatus === 'loading' && <p className="text-sm text-slate-500">회원 정보를 불러오는 중입니다.</p>}
            {detailStatus === 'error' && <p className="text-sm text-red-600">{roleMessage}</p>}
            {detail && <MemberDetailView member={detail} />}
            <button onClick={() => { setDetail(null); setDetailStatus('idle') }} className="mt-6 w-full rounded-xl border px-4 py-3 text-sm">닫기</button>
          </div>
        </div>
      )}

      {promoteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-xl">
            <h2 className="text-lg font-semibold">정회원 승급</h2>
            <p className="mt-1 text-sm text-slate-500">{value(promoteTarget.legal_name)}</p>
            <input value={promoteReason} onChange={(event) => setPromoteReason(event.target.value)} placeholder="승급 사유" className="mt-5 w-full rounded-xl border p-3 text-sm" />
            {promoteMessage && <p className="mt-2 text-sm text-slate-600">{promoteMessage}</p>}
            <div className="mt-5 flex gap-2"><button onClick={promote} className="flex-1 rounded-xl bg-emerald-600 p-3 text-sm font-semibold text-white">승급</button><button onClick={() => setPromoteTarget(null)} className="flex-1 rounded-xl border p-3 text-sm">취소</button></div>
          </div>
        </div>
      )}
    </>
  )
}

function MemberDetailView({ member }: { member: MemberDetail }) {
  const rows = [
    ['이름', value(member.legal_name)], ['회원번호', member.member_no], ['등급', GRADE_LABEL[member.grade] ?? member.grade],
    ['상태', STATUS_LABEL[member.status] ?? member.status], ['가입일', date(member.joined_at)], ['생년월일', value(member.birth_date)],
    ['성별', member.gender === 'female' ? '여성' : member.gender === 'male' ? '남성' : value(member.gender)], ['이메일', value(member.email)],
    ['닉네임', value(member.nickname)], ['소속', value(member.company_name)], ['직무/직책', value(member.job_title)],
    ['관심사', member.interests?.length ? member.interests.join(', ') : '등록된 정보가 없습니다.'], ['준회원 포인트', `${member.total_points ?? 0}점`],
    ['승급 대상', member.grade === 'associate' && member.total_points >= 5 ? '예' : '아니오'],
  ]
  return <div>
    <h2 className="text-xl font-semibold">회원 상세 정보</h2>
    <dl className="mt-5 grid gap-3 sm:grid-cols-2">{rows.map(([label, content]) => <div key={label} className="rounded-xl bg-[#F5F4F1] p-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm">{content}</dd></div>)}</dl>
    <div className="mt-4 rounded-xl bg-[#F5F4F1] p-3"><p className="text-xs text-slate-500">자기소개</p><p className="mt-1 whitespace-pre-wrap text-sm">{value(member.introduction)}</p></div>
    <div className="mt-4"><p className="text-xs text-slate-500">현재 운영진 역할</p><div className="mt-2 flex flex-wrap gap-1">{member.active_roles.length ? member.active_roles.map((role) => <span key={role.code} className="rounded-full bg-slate-900 px-2.5 py-1 text-xs text-white">{ROLES.find((item) => item.code === role.code)?.label ?? role.name}</span>) : <span className="text-sm">등록된 정보가 없습니다.</span>}</div></div>
    <div className="mt-4"><p className="text-xs text-slate-500">회원번호 이력</p><div className="mt-2 space-y-2">{member.member_number_history.length ? member.member_number_history.map((item) => <div key={`${item.member_no}-${item.valid_from}`} className="rounded-xl border p-3 text-sm"><span className="font-mono font-semibold">{item.member_no}</span><span className="ml-2 text-xs text-slate-500">{date(item.valid_from)} ~ {item.valid_to ? date(item.valid_to) : '현재'} · {item.change_reason}</span></div>) : <p className="text-sm">등록된 정보가 없습니다.</p>}</div></div>
  </div>
}
