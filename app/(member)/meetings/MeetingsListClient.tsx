'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { MeetingListItem } from './page'

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

const STATUS_FILTERS = [
  { value: 'all', label: '전체' },
  { value: 'recruiting', label: '모집중' },
  { value: 'active', label: '활동중' },
  { value: 'ended', label: '종료' },
]

const TYPE_FILTERS = [
  { value: 'all', label: '전체' },
  { value: 'study', label: '스터디' },
  { value: 'project', label: '프로젝트' },
  { value: 'lecture', label: '강연' },
  { value: 'lightning', label: '번개' },
  { value: 'regular_networking', label: '정기 네트워킹' },
]

function formatDate(value: string | null) {
  if (!value) return null
  return new Date(value).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })
}

export default function MeetingsListClient({ meetings }: { meetings: MeetingListItem[] }) {
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')

  const filtered = useMemo(() => {
    return meetings.filter((m) => {
      if (statusFilter !== 'all' && m.status !== statusFilter) return false
      if (typeFilter !== 'all' && m.meeting_type !== typeFilter) return false
      return true
    })
  }, [meetings, statusFilter, typeFilter])

  return (
    <div className="space-y-3">
      {/* Status filters */}
      <div className="flex gap-2 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              statusFilter === f.value
                ? 'bg-[var(--iuna-navy)] text-white'
                : 'border border-[var(--iuna-line)] bg-white text-[var(--iuna-muted)] hover:bg-[var(--iuna-warm)]'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Type filters */}
      <div className="flex gap-2 flex-wrap">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setTypeFilter(f.value)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              typeFilter === f.value
                ? 'bg-[var(--iuna-navy)] text-white'
                : 'border border-[var(--iuna-line)] bg-white text-[var(--iuna-muted)] hover:bg-[var(--iuna-warm)]'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-slate-400">조건에 맞는 모임이 없습니다.</p>
        </div>
      ) : (
        <div className="iuna-card overflow-hidden">
          {filtered.map((m) => (
            <Link
              key={m.id}
              href={`/meetings/${m.id}`}
              className="flex items-center gap-3 border-b border-[var(--iuna-line)] px-4 py-4 last:border-b-0 transition hover:bg-[var(--iuna-warm)]"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="iuna-badge shrink-0">
                    {TYPE_LABEL[m.meeting_type] ?? m.meeting_type}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_COLOR[m.status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                    {STATUS_LABEL[m.status] ?? m.status}
                  </span>
                </div>
                <p className="text-sm font-semibold truncate">{m.title}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {m.creator_name && <span>{m.creator_name}</span>}
                  {m.period_start && <span>{m.creator_name ? ' · ' : ''}{formatDate(m.period_start)}</span>}
                  {m.capacity && <span> · 정원 {m.capacity}명</span>}
                </p>
              </div>
              <span className="text-slate-300 shrink-0">→</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
