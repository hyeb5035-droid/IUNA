'use client'

import { useMemo, useState } from 'react'
import type { ActiveRole, MemberRow } from './page'

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

const STATUS_COLOR: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  dormant: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  withdrawn: 'bg-slate-100 text-slate-500 border-slate-200',
  expelled: 'bg-red-50 text-red-700 border-red-200',
}

// Operator role options for assignment
const OPERATOR_ROLE_OPTIONS = [
  { code: 'operator', name: '일반 운영진' },
  { code: 'member_admin', name: '회원 관리 운영진' },
  { code: 'meeting_admin', name: '모임 관리 운영진' },
  { code: 'super_admin', name: '슈퍼 운영진' },
] as const

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

type Props = { members: MemberRow[] }

type PromoteState = {
  target: MemberRow | null
  reason: string
  status: 'idle' | 'confirming' | 'loading' | 'success' | 'error'
  message: string
  newMemberNo: string
}

type RoleActionState = {
  target: MemberRow | null
  actionType: 'assign' | 'revoke'
  selectedRole: string
  status: 'idle' | 'loading' | 'success' | 'error'
  message: string
}

export default function MemberListClient({ members: initialMembers }: Props) {
  const [members, setMembers] = useState(initialMembers)
  const [query, setQuery] = useState('')
  const [gradeFilter, setGradeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [promote, setPromote] = useState<PromoteState>({
    target: null,
    reason: '',
    status: 'idle',
    message: '',
    newMemberNo: '',
  })

  // Operator role management state
  const [roleAction, setRoleAction] = useState<RoleActionState>({
    target: null,
    actionType: 'assign',
    selectedRole: '',
    status: 'idle',
    message: '',
  })

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return members.filter((m) => {
      if (gradeFilter !== 'all' && m.grade !== gradeFilter) return false
      if (statusFilter !== 'all' && m.status !== statusFilter) return false
      if (q) {
        const nameMatch = (m.legal_name ?? '').toLowerCase().includes(q)
        const noMatch = m.member_no.includes(q)
        if (!nameMatch && !noMatch) return false
      }
      return true
    })
  }, [members, query, gradeFilter, statusFilter])

  function openPromote(member: MemberRow) {
    setPromote({ target: member, reason: '', status: 'confirming', message: '', newMemberNo: '' })
  }

  function closePromote() {
    setPromote({ target: null, reason: '', status: 'idle', message: '', newMemberNo: '' })
  }

  async function executePromote() {
    if (!promote.target || !promote.reason.trim()) return
    setPromote((prev) => ({ ...prev, status: 'loading' }))

    try {
      const res = await fetch('/api/admin/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: promote.target.id,
          reason: promote.reason.trim(),
        }),
      })

      const body = await res.json().catch(() => ({}))

      if (res.ok && body.new_member_no) {
        // Update local state
        setMembers((prev) =>
          prev.map((m) =>
            m.id === promote.target!.id
              ? { ...m, grade: 'regular', member_no: body.new_member_no }
              : m,
          ),
        )
        setPromote((prev) => ({
          ...prev,
          status: 'success',
          newMemberNo: body.new_member_no,
          message: '정회원 승급이 완료되었습니다.',
        }))
      } else {
        setPromote((prev) => ({
          ...prev,
          status: 'error',
          message: typeof body.error === 'string' ? body.error : '승급 처리 중 오류가 발생했습니다.',
        }))
      }
    } catch {
      setPromote((prev) => ({
        ...prev,
        status: 'error',
        message: '네트워크 오류가 발생했습니다. 다시 시도해주세요.',
      }))
    }
  }

  // Role management functions
  function openAssignRole(member: MemberRow) {
    setRoleAction({
      target: member,
      actionType: 'assign',
      selectedRole: 'operator',
      status: 'idle',
      message: '',
    })
  }

  function openRevokeRole(member: MemberRow, roleCode: string) {
    setRoleAction({
      target: member,
      actionType: 'revoke',
      selectedRole: roleCode,
      status: 'idle',
      message: '',
    })
  }

  function closeRoleAction() {
    setRoleAction({
      target: null,
      actionType: 'assign',
      selectedRole: '',
      status: 'idle',
      message: '',
    })
  }

  async function executeAssignRole() {
    if (!roleAction.target || !roleAction.selectedRole) return
    setRoleAction((prev) => ({ ...prev, status: 'loading' }))

    try {
      const res = await fetch('/api/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'assign',
          user_id: roleAction.target.id,
          role_code: roleAction.selectedRole,
        }),
      })

      const body = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(body.error || '작업 처리 중 오류가 발생했습니다.')
      }

      // Refresh the member data to get updated roles and member_no
      const refreshRes = await fetch('/api/admin/members')
      const refreshData = await refreshRes.json()
      if (refreshData.members) {
        setMembers(refreshData.members)
      }

      setRoleAction((prev) => ({
        ...prev,
        status: 'success',
        message: '운영진 지정이 완료되었습니다.',
      }))
    } catch (err: any) {
      setRoleAction((prev) => ({
        ...prev,
        status: 'error',
        message: err?.message || '작업 처리 중 오류가 발생했습니다.',
      }))
    }
  }

  async function executeRevokeRole() {
    if (!roleAction.target || !roleAction.selectedRole) return
    setRoleAction((prev) => ({ ...prev, status: 'loading' }))

    try {
      const res = await fetch('/api/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'revoke',
          user_id: roleAction.target.id,
          role_code: roleAction.selectedRole,
        }),
      })

      const body = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(body.error || '작업 처리 중 오류가 발생했습니다.')
      }

      // Refresh the member data to get updated roles and member_no
      const refreshRes = await fetch('/api/admin/members')
      const refreshData = await refreshRes.json()
      if (refreshData.members) {
        setMembers(refreshData.members)
      }

      setRoleAction((prev) => ({
        ...prev,
        status: 'success',
        message: '권한 해제가 완료되었습니다.',
      }))
    } catch (err: any) {
      setRoleAction((prev) => ({
        ...prev,
        status: 'error',
        message: err?.message || '작업 처리 중 오류가 발생했습니다.',
      }))
    }
  }

  const canPromote = (m: MemberRow) => m.grade === 'associate' && m.status === 'active'
  const canAssignOperator = (m: MemberRow) => m.grade === 'regular' && m.status === 'active' && !m.isOperator
  const canRevokeOperator = (m: MemberRow) => m.isOperator

  return (
    <>
      <div className="rounded-2xl bg-white border border-[#E5E1DA] overflow-hidden">
        {/* Search + Filters */}
        <div className="p-5 border-b border-[#DDDCD7] space-y-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="회원번호 또는 이름 검색"
            className="w-full rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] px-4 py-2.5 text-sm outline-none focus:border-[#0A0A0A]"
          />
          <div className="flex flex-wrap gap-2">
            <div className="flex rounded-xl border border-[#DDDCD7] overflow-hidden text-xs font-medium">
              {[
                { value: 'all', label: '전체' },
                { value: 'associate', label: '준회원' },
                { value: 'regular', label: '정회원' },
                { value: 'honorary', label: '명예회원' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setGradeFilter(opt.value)}
                  className={`px-3 py-1.5 transition ${
                    gradeFilter === opt.value
                      ? 'bg-[#0A0A0A] text-white'
                      : 'bg-white text-[#111111] hover:bg-[#F5F4F1]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex rounded-xl border border-[#DDDCD7] overflow-hidden text-xs font-medium">
              {[
                { value: 'all', label: '전체' },
                { value: 'active', label: '활동' },
                { value: 'dormant', label: '휴면' },
                { value: 'withdrawn', label: '탈퇴' },
                { value: 'expelled', label: '제명' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setStatusFilter(opt.value)}
                  className={`px-3 py-1.5 transition ${
                    statusFilter === opt.value
                      ? 'bg-[#0A0A0A] text-white'
                      : 'bg-white text-[#111111] hover:bg-[#F5F4F1]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          {(query || gradeFilter !== 'all' || statusFilter !== 'all') && (
            <p className="text-xs text-slate-500">{filtered.length}명 표시 중</p>
          )}
        </div>

        {/* Table — desktop */}
        <div className="hidden sm:block overflow-x-auto">
          {filtered.length === 0 ? (
            <p className="px-6 py-10 text-sm text-slate-400 text-center">검색 결과가 없습니다.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#DDDCD7] bg-[#F5F4F1] text-left text-xs font-medium text-slate-500">
                  <th className="px-5 py-3">회원번호</th>
                  <th className="px-5 py-3">이름</th>
                  <th className="px-5 py-3">등급</th>
                  <th className="px-5 py-3">상태</th>
                  <th className="px-5 py-3">가입일</th>
                  <th className="px-5 py-3">포인트</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DDDCD7]">
                {filtered.map((m) => (
                  <tr key={m.member_no} className="hover:bg-[#F5F4F1] transition">
                    <td className="px-5 py-3.5 font-mono font-semibold tracking-wider">{m.member_no}</td>
                    <td className="px-5 py-3.5">{m.legal_name ?? <span className="text-slate-400">—</span>}</td>
                    <td className="px-5 py-3.5">
                      {m.isOperator ? (
                        <div className="flex flex-wrap items-center gap-1">
                          {m.activeRoles.map((role) => (
                            <span
                              key={role.code}
                              className="inline-flex rounded-full bg-[#0A0A0A] px-2 py-0.5 text-xs font-medium text-white"
                              title={role.name}
                            >
                              {role.code === 'super_admin' ? '슈퍼' : role.code === 'member_admin' ? '회원' : role.code === 'meeting_admin' ? '모임' : '운영진'}
                            </span>
                          ))}
                          <span className="text-xs text-slate-400">{GRADE_LABEL[m.grade] ?? m.grade}</span>
                        </div>
                      ) : (
                        GRADE_LABEL[m.grade] ?? m.grade
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_COLOR[m.status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                        {STATUS_LABEL[m.status] ?? m.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-500">{formatDate(m.created_at)}</td>
                    <td className="px-5 py-3.5">
                      {m.points !== null && (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-sm">{m.points}점</span>
                          {m.points >= 5 && (
                            <span className="inline-flex rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white shadow-sm">승급 대상</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {canAssignOperator(m) && (
                          <button
                            onClick={() => openAssignRole(m)}
                            className="rounded-lg bg-[#0A0A0A] px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 transition"
                          >
                            운영진 지정
                          </button>
                        )}
                        {canRevokeOperator(m) && m.activeRoles.map((role) => (
                          <button
                            key={role.code}
                            onClick={() => openRevokeRole(m, role.code)}
                            className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-100 transition"
                          >
                            {role.name} 해제
                          </button>
                        ))}
                        {canPromote(m) && (
                          <button
                            onClick={() => openPromote(m)}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 transition"
                          >
                            정회원 승급
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Cards — mobile */}
        <div className="sm:hidden divide-y divide-[#DDDCD7]">
          {filtered.length === 0 ? (
            <p className="px-5 py-10 text-sm text-slate-400 text-center">검색 결과가 없습니다.</p>
          ) : (
            filtered.map((m) => (
              <div key={m.member_no} className="px-5 py-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold tracking-wider text-sm">{m.member_no}</span>
                  <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_COLOR[m.status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                    {STATUS_LABEL[m.status] ?? m.status}
                  </span>
                </div>
                <p className="text-sm font-medium">{m.legal_name ?? <span className="text-slate-400">이름 없음</span>}</p>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-500">
                    {m.isOperator && (
                      <span className="flex flex-wrap gap-1 mb-1">
                        {m.activeRoles.map((role) => (
                          <span
                            key={role.code}
                            className="inline-flex rounded-full bg-[#0A0A0A] px-2 py-0.5 text-xs font-medium text-white"
                          >
                            {role.code === 'super_admin' ? '슈퍼' : role.code === 'member_admin' ? '회원' : role.code === 'meeting_admin' ? '모임' : '운영진'}
                          </span>
                        ))}
                      </span>
                    )}
                    {GRADE_LABEL[m.grade] ?? m.grade} · {formatDate(m.created_at)} 가입
                    {m.points !== null && <span className="ml-1.5">{m.points}점</span>}
                    {m.points !== null && m.points >= 5 && <span className="ml-1 inline-flex rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white">승급 대상</span>}
                  </p>
                  <div className="flex items-center justify-end gap-2 mt-2">
                    {canAssignOperator(m) && (
                      <button
                        onClick={() => openAssignRole(m)}
                        className="rounded-lg bg-[#0A0A0A] px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 transition"
                      >
                        운영진 지정
                      </button>
                    )}
                    {canRevokeOperator(m) && m.activeRoles.map((role) => (
                      <button
                        key={role.code}
                        onClick={() => openRevokeRole(m, role.code)}
                        className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-100 transition"
                      >
                        {role.name} 해제
                      </button>
                    ))}
                    {canPromote(m) && (
                      <button
                        onClick={() => openPromote(m)}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 transition"
                      >
                        승급
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Promotion Dialog */}
      {promote.target && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-3xl bg-white border border-[#DDDCD7] p-8 shadow-xl">
            {promote.status === 'success' ? (
              <>
                <h2 className="text-lg font-semibold text-emerald-700">승급 완료</h2>
                <p className="mt-3 text-sm text-slate-700">{promote.message}</p>
                <p className="mt-2 text-sm">
                  새 회원번호: <span className="font-mono font-bold tracking-widest">{promote.newMemberNo}</span>
                </p>
                <button
                  onClick={closePromote}
                  className="mt-6 w-full rounded-2xl bg-[#0A0A0A] px-5 py-3 text-sm font-semibold text-white hover:bg-slate-900 transition"
                >
                  확인
                </button>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold">정회원 승급</h2>
                <p className="mt-2 text-sm text-slate-600">
                  <span className="font-medium">{promote.target.legal_name ?? promote.target.member_no}</span>
                  {' '}회원을 정회원으로 승급하시겠습니까?
                </p>
                <div className="mt-5">
                  <label className="block text-sm font-medium mb-1.5">승급 사유</label>
                  <input
                    type="text"
                    value={promote.reason}
                    onChange={(e) => setPromote((prev) => ({ ...prev, reason: e.target.value }))}
                    placeholder="예: 활동 참여 기준 충족"
                    className="w-full rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] px-4 py-3 text-sm outline-none focus:border-[#0A0A0A]"
                    disabled={promote.status === 'loading'}
                  />
                </div>
                {promote.status === 'error' && (
                  <p className="mt-3 text-sm text-red-500">{promote.message}</p>
                )}
                <div className="mt-6 flex gap-3">
                  <button
                    onClick={executePromote}
                    disabled={promote.status === 'loading' || !promote.reason.trim()}
                    className="flex-1 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {promote.status === 'loading' ? '처리 중...' : '승급 확인'}
                  </button>
                  <button
                    onClick={closePromote}
                    disabled={promote.status === 'loading'}
                    className="flex-1 rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] px-5 py-3 text-sm font-semibold transition hover:bg-white disabled:opacity-50"
                  >
                    취소
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Role Action Dialog — Assign or Revoke */}
      {roleAction.target && roleAction.actionType === 'assign' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-3xl bg-white border border-[#DDDCD7] p-8 shadow-xl">
            {roleAction.status === 'success' ? (
              <>
                <h2 className="text-lg font-semibold text-emerald-700">완료</h2>
                <p className="mt-3 text-sm text-slate-700">{roleAction.message}</p>
                <button
                  onClick={closeRoleAction}
                  className="mt-6 w-full rounded-2xl bg-[#0A0A0A] px-5 py-3 text-sm font-semibold text-white hover:bg-slate-900 transition"
                >
                  확인
                </button>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold">운영진 지정</h2>
                <p className="mt-2 text-sm text-slate-600">
                  <span className="font-medium">{roleAction.target.legal_name ?? roleAction.target.member_no}</span>
                  {' '}님에게 역할을 부여합니다.
                </p>
                <div className="mt-5">
                  <label className="block text-sm font-medium mb-1.5">역할 선택</label>
                  <select
                    value={roleAction.selectedRole}
                    onChange={(e) => setRoleAction((prev) => ({ ...prev, selectedRole: e.target.value }))}
                    className="w-full rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] px-4 py-3 text-sm outline-none focus:border-[#0A0A0A]"
                    disabled={roleAction.status === 'loading'}
                  >
                    {OPERATOR_ROLE_OPTIONS.map((opt) => (
                      <option key={opt.code} value={opt.code}>
                        {opt.name}
                      </option>
                    ))}
                  </select>
                </div>
                {roleAction.status === 'error' && (
                  <p className="mt-3 text-sm text-red-500">{roleAction.message}</p>
                )}
                <div className="mt-6 flex gap-3">
                  <button
                    onClick={executeAssignRole}
                    disabled={roleAction.status === 'loading' || !roleAction.selectedRole}
                    className="flex-1 rounded-2xl bg-[#0A0A0A] px-5 py-3 text-sm font-semibold text-white hover:bg-slate-900 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {roleAction.status === 'loading' ? '처리 중...' : '지정'}
                  </button>
                  <button
                    onClick={closeRoleAction}
                    disabled={roleAction.status === 'loading'}
                    className="flex-1 rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] px-5 py-3 text-sm font-semibold transition hover:bg-white disabled:opacity-50"
                  >
                    취소
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Role Revocation Dialog */}
      {roleAction.target && roleAction.actionType === 'revoke' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-3xl bg-white border border-[#DDDCD7] p-8 shadow-xl">
            {roleAction.status === 'success' ? (
              <>
                <h2 className="text-lg font-semibold text-emerald-700">완료</h2>
                <p className="mt-3 text-sm text-slate-700">{roleAction.message}</p>
                <button
                  onClick={closeRoleAction}
                  className="mt-6 w-full rounded-2xl bg-[#0A0A0A] px-5 py-3 text-sm font-semibold text-white hover:bg-slate-900 transition"
                >
                  ���인
                </button>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold">권한 해제</h2>
                <p className="mt-2 text-sm text-slate-600">
                  <span className="font-medium">{roleAction.target.legal_name ?? roleAction.target.member_no}</span>
                  {' '}님의 {OPERATOR_ROLE_OPTIONS.find(o => o.code === roleAction.selectedRole)?.name ?? roleAction.selectedRole} 권한을 해제하시겠습니까?
                </p>
                {roleAction.status === 'error' && (
                  <p className="mt-3 text-sm text-red-500">{roleAction.message}</p>
                )}
                <div className="mt-6 flex gap-3">
                  <button
                    onClick={executeRevokeRole}
                    disabled={roleAction.status === 'loading'}
                    className="flex-1 rounded-2xl bg-red-600 px-5 py-3 text-sm font-semibold text-white hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {roleAction.status === 'loading' ? '처리 중...' : '해제'}
                  </button>
                  <button
                    onClick={closeRoleAction}
                    disabled={roleAction.status === 'loading'}
                    className="flex-1 rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] px-5 py-3 text-sm font-semibold transition hover:bg-white disabled:opacity-50"
                  >
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
