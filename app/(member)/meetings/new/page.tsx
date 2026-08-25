'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
const supabase = createBrowserClient(supabaseUrl, supabaseKey)

const MEETING_TYPES = [
  { value: 'study', label: '스터디' },
  { value: 'project', label: '프로젝트' },
  { value: 'lecture', label: '강연' },
  { value: 'lightning', label: '번개' },
  { value: 'regular_networking', label: '정기 네트워킹' },
]

type FormState = {
  meeting_type: string
  title: string
  description: string
  goals: string
  details: string
  period_start: string
  period_end: string
  capacity: string
  support_request: string
  regular_only: boolean
  lecture_fee: string
  revenue_share_organizer: string
  revenue_share_member: string
}

const initial: FormState = {
  meeting_type: 'study',
  title: '',
  description: '',
  goals: '',
  details: '',
  period_start: '',
  period_end: '',
  capacity: '',
  support_request: '',
  regular_only: false,
  lecture_fee: '',
  revenue_share_organizer: '5',
  revenue_share_member: '5',
}

export default function MeetingNewPage() {
  const router = useRouter()
  const [form, setForm] = useState<FormState>(initial)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [canCreate, setCanCreate] = useState<boolean | null>(null)
  const [isOperator, setIsOperator] = useState(false)
  const checkedRef = useRef(false)

  useEffect(() => {
    if (checkedRef.current) return
    checkedRef.current = true

    async function check() {
      const { data: sessionData } = await supabase.auth.getSession()
      const userId = sessionData?.session?.user?.id
      if (!userId) { router.replace('/login'); return }

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
      setIsOperator(hasActiveRole)

      if (membership?.grade === 'associate' && !hasActiveRole) {
        setCanCreate(false)
        return
      }

      setCanCreate(true)
    }

    check()
  }, [router])

  function updateField(field: keyof FormState, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrorMsg('')
  }

  function validate(): string | null {
    if (!form.meeting_type) return '모임 유형을 선택해주세요.'
    if (!form.title.trim()) return '모임명을 입력해주세요.'
    if (!form.period_start) return '시작일을 입력해주세요.'
    if (form.period_end && form.period_end < form.period_start) return '종료일은 시작일 이후여야 합니다.'
    if (form.capacity && (isNaN(Number(form.capacity)) || Number(form.capacity) <= 0)) return '정원은 양의 정수여야 합니다.'
    if (form.meeting_type === 'regular_networking' && !isOperator) return '정기 네트워킹은 운영진만 생성할 수 있습니다.'
    if (form.meeting_type === 'lecture') {
      const org = Number(form.revenue_share_organizer)
      const mem = Number(form.revenue_share_member)
      if (isNaN(org) || isNaN(mem) || org < 0 || mem < 0 || org + mem !== 10) {
        return '수익배분 합계는 10이어야 합니다.'
      }
    }
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const err = validate()
    if (err) { setErrorMsg(err); return }

    setIsSubmitting(true)
    setErrorMsg('')

    const { data: session } = await supabase.auth.getSession()
    const userId = session?.session?.user?.id
    if (!userId) { setErrorMsg('인증이 필요합니다.'); setIsSubmitting(false); return }

    const isLecture = form.meeting_type === 'lecture'

    const payload: Record<string, unknown> = {
      meeting_type: form.meeting_type,
      title: form.title.trim(),
      description: form.description.trim() || null,
      goals: form.goals.trim() || null,
      details: form.details.trim() || null,
      period_start: form.period_start || null,
      period_end: form.period_end || null,
      capacity: form.capacity ? Number(form.capacity) : null,
      support_request: form.support_request.trim() || null,
      regular_only: form.regular_only,
      lecture_fee: isLecture && form.lecture_fee ? Number(form.lecture_fee) : null,
      revenue_share_organizer: isLecture ? Number(form.revenue_share_organizer) : null,
      revenue_share_member: isLecture ? Number(form.revenue_share_member) : null,
      created_by: userId,
      status: 'pending_approval',
    }

    const { data, error } = await supabase
      .from('meetings')
      .insert(payload)
      .select('id')
      .single()

    if (error) {
      setIsSubmitting(false)
      const msg = error.message ?? ''
      if (msg.includes('can_create_meeting') || msg.includes('violates row-level security')) {
        setErrorMsg('모임 생성 권한이 없습니다.')
      } else {
        setErrorMsg('모임 생성 중 오류가 발생했습니다.')
      }
      console.error('[meetings/new] insert error:', error.code, error.message)
      return
    }

    router.push(`/meetings/${data.id}`)
  }

  if (canCreate === null) {
    return (
      <main className="min-h-screen bg-[#F7F6F2] px-4 py-8 text-[#111111]">
        <div className="mx-auto max-w-xl py-12 text-center">
          <p className="text-sm text-slate-500">확인 중...</p>
        </div>
      </main>
    )
  }

  if (!canCreate) {
    return (
      <main className="min-h-screen bg-[#F7F6F2] px-4 py-8 text-[#111111]">
        <div className="mx-auto max-w-xl rounded-2xl border border-[#E5E1DA] bg-white p-6">
          <h1 className="text-lg font-semibold">모임 생성 불가</h1>
          <p className="mt-2 text-sm text-slate-600">준회원은 모임을 생성할 수 없습니다. 정회원 승급 후 이용해주세요.</p>
        </div>
      </main>
    )
  }

  const isLecture = form.meeting_type === 'lecture'
  const availableTypes = isOperator
    ? MEETING_TYPES
    : MEETING_TYPES.filter((t) => t.value !== 'regular_networking')

  return (
    <main className="min-h-screen bg-[#F7F6F2] px-4 py-8 text-[#111111] sm:px-6">
      <div className="mx-auto max-w-xl space-y-4">

        {/* Header */}
        <div>
          <p className="text-xs text-slate-500">새로운 활동 만들기</p>
          <h1 className="text-xl font-semibold">모임 개설</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* 모임 유형 */}
          <section className="rounded-2xl border border-[#E5E1DA] bg-white px-5 py-4">
            <h2 className="text-sm font-semibold mb-3">모임 유형</h2>
            <div className="flex flex-wrap gap-2">
              {availableTypes.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => updateField('meeting_type', t.value)}
                  className={`rounded-xl px-4 py-2 text-sm font-medium border transition ${
                    form.meeting_type === t.value
                      ? 'border-[#111111] bg-[#111111] text-white'
                      : 'border-[#E5E1DA] bg-white text-slate-600 hover:bg-[#F5F4F1]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </section>

          {/* 기본 정보 */}
          <section className="rounded-2xl border border-[#E5E1DA] bg-white px-5 py-4 space-y-4">
            <h2 className="text-sm font-semibold">기본 정보</h2>
            <Field label="모임명 *">
              <input
                type="text"
                value={form.title}
                onChange={(e) => updateField('title', e.target.value)}
                placeholder="모임명을 입력해주세요"
                className="w-full rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm outline-none focus:border-[#111111]"
              />
            </Field>
            <Field label="소개">
              <textarea
                rows={3}
                value={form.description}
                onChange={(e) => updateField('description', e.target.value)}
                placeholder="모임을 한 줄로 소개해주세요"
                className="w-full rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm outline-none focus:border-[#111111]"
              />
            </Field>
            <Field label="목표">
              <textarea
                rows={2}
                value={form.goals}
                onChange={(e) => updateField('goals', e.target.value)}
                placeholder="무엇을 이루고 싶나요?"
                className="w-full rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm outline-none focus:border-[#111111]"
              />
            </Field>
            <Field label="상세내용">
              <textarea
                rows={4}
                value={form.details}
                onChange={(e) => updateField('details', e.target.value)}
                className="w-full rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm outline-none focus:border-[#111111]"
              />
            </Field>
          </section>

          {/* 일정 및 모집 */}
          <section className="rounded-2xl border border-[#E5E1DA] bg-white px-5 py-4 space-y-4">
            <h2 className="text-sm font-semibold">일정 및 모집</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="시작일 *">
                <input
                  type="date"
                  value={form.period_start}
                  onChange={(e) => updateField('period_start', e.target.value)}
                  className="w-full rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm outline-none focus:border-[#111111]"
                />
              </Field>
              <Field label="종료일">
                <input
                  type="date"
                  value={form.period_end}
                  onChange={(e) => updateField('period_end', e.target.value)}
                  className="w-full rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm outline-none focus:border-[#111111]"
                />
              </Field>
            </div>
            <Field label="정원">
              <input
                type="number"
                min="1"
                value={form.capacity}
                onChange={(e) => updateField('capacity', e.target.value)}
                placeholder="미입력 시 제한 없음"
                className="w-full rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm outline-none focus:border-[#111111]"
              />
            </Field>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={form.regular_only}
                onChange={(e) => updateField('regular_only', e.target.checked)}
                className="h-4 w-4 rounded border-[#DDDCD7]"
              />
              <span className="text-sm">정회원 전용</span>
            </label>
          </section>

          {/* 기타 */}
          <section className="rounded-2xl border border-[#E5E1DA] bg-white px-5 py-4 space-y-4">
            <h2 className="text-sm font-semibold">기타</h2>
            <Field label="지원요청">
              <textarea
                rows={2}
                value={form.support_request}
                onChange={(e) => updateField('support_request', e.target.value)}
                placeholder="운영진에게 지원받고 싶은 사항"
                className="w-full rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm outline-none focus:border-[#111111]"
              />
            </Field>
          </section>

          {/* 강연 조건 */}
          {isLecture && (
            <section className="rounded-2xl border border-[#E5E1DA] bg-white px-5 py-4 space-y-4">
              <h2 className="text-sm font-semibold">강연 조건</h2>
              <Field label="강연료 (원)">
                <input
                  type="number"
                  min="0"
                  value={form.lecture_fee}
                  onChange={(e) => updateField('lecture_fee', e.target.value)}
                  className="w-full rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm outline-none focus:border-[#111111]"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="주최측 배분">
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={form.revenue_share_organizer}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      setForm((prev) => ({
                        ...prev,
                        revenue_share_organizer: e.target.value,
                        revenue_share_member: String(10 - (isNaN(v) ? 0 : Math.min(10, Math.max(0, v)))),
                      }))
                    }}
                    className="w-full rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm outline-none focus:border-[#111111]"
                  />
                </Field>
                <Field label="회원/강연자 배분">
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={form.revenue_share_member}
                    disabled
                    className="w-full rounded-xl border border-[#E5E1DA] bg-slate-50 px-4 py-2.5 text-sm"
                  />
                </Field>
              </div>
            </section>
          )}

          {errorMsg && <p className="text-sm text-red-500 px-1">{errorMsg}</p>}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 rounded-xl bg-[#111111] px-5 py-3 text-sm font-semibold text-white hover:bg-slate-900 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? '생성 중...' : '승인 요청'}
            </button>
            <button
              type="button"
              onClick={() => router.push('/meetings')}
              disabled={isSubmitting}
              className="flex-1 rounded-xl border border-[#E5E1DA] bg-white px-5 py-3 text-sm font-semibold transition hover:bg-[#F5F4F1] disabled:opacity-50"
            >
              취소
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1.5">{label}</label>
      {children}
    </div>
  )
}
