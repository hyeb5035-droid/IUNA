'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

const supabase = createBrowserClient(supabaseUrl, supabaseKey)

type FormState = {
  company_name: string
  job_title: string
  introduction: string
  interests: string
}

export default function ProfileEditPage() {
  const router = useRouter()
  const [form, setForm] = useState<FormState>({
    company_name: '',
    job_title: '',
    introduction: '',
    interests: '',
  })
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true

    async function loadProfile() {
      const { data: sessionData } = await supabase.auth.getSession()
      const userId = sessionData?.session?.user?.id
      if (!userId) {
        router.replace('/login')
        return
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('company_name, job_title, introduction, interests')
        .eq('id', userId)
        .single()

      if (error || !data) {
        setStatusMessage({ type: 'error', text: '프로필을 불러올 수 없습니다.' })
        setIsLoading(false)
        return
      }

      const interestsStr = Array.isArray(data.interests)
        ? data.interests.join(', ')
        : ''

      setForm({
        company_name: data.company_name ?? '',
        job_title: data.job_title ?? '',
        introduction: data.introduction ?? '',
        interests: interestsStr,
      })
      setIsLoading(false)
    }

    loadProfile()
  }, [router])

  function updateField(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setStatusMessage(null)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSaving(true)
    setStatusMessage(null)

    try {
      const response = await fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: form.company_name,
          job_title: form.job_title,
          introduction: form.introduction,
          interests: form.interests,
        }),
      })

      if (response.ok) {
        setStatusMessage({ type: 'success', text: '저장되었습니다.' })
        // Navigate back to /my after short delay so user sees the success message
        setTimeout(() => router.push('/my'), 800)
        return
      }

      const body = await response.json().catch(() => ({}))
      setStatusMessage({
        type: 'error',
        text: typeof body.error === 'string' ? body.error : '저장 중 오류가 발생했습니다.',
      })
    } catch {
      setStatusMessage({ type: 'error', text: '저장 중 오류가 발생했습니다. 다시 시도해주세요.' })
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <main className="min-h-screen bg-[#F5F4F1] px-4 py-12 text-[#111111] sm:px-6">
        <div className="mx-auto max-w-xl rounded-3xl bg-white border border-[#DDDCD7] p-8 shadow-sm">
          <p className="text-slate-500 text-sm">불러오는 중...</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#F5F4F1] px-4 py-12 text-[#111111] sm:px-6">
      <div className="mx-auto max-w-xl rounded-3xl bg-white border border-[#DDDCD7] p-8 shadow-sm">
        <h1 className="text-2xl font-semibold mb-8">프로필 수정</h1>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="mb-1.5 block text-sm font-medium">소속 / 회사명</label>
            <input
              type="text"
              value={form.company_name}
              onChange={(e) => updateField('company_name', e.target.value)}
              className="w-full rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] px-4 py-3 text-sm outline-none focus:border-[#0A0A0A]"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">직무 / 직업</label>
            <input
              type="text"
              value={form.job_title}
              onChange={(e) => updateField('job_title', e.target.value)}
              className="w-full rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] px-4 py-3 text-sm outline-none focus:border-[#0A0A0A]"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">자기소개</label>
            <textarea
              rows={4}
              value={form.introduction}
              onChange={(e) => updateField('introduction', e.target.value)}
              className="w-full rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] px-4 py-3 text-sm outline-none focus:border-[#0A0A0A]"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">관심사</label>
            <input
              type="text"
              value={form.interests}
              onChange={(e) => updateField('interests', e.target.value)}
              placeholder="쉼표로 구분하여 입력  예: 음악, 여행"
              className="w-full rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] px-4 py-3 text-sm outline-none focus:border-[#0A0A0A]"
            />
          </div>

          {statusMessage && (
            <p className={`text-sm ${statusMessage.type === 'success' ? 'text-emerald-600' : 'text-red-500'}`}>
              {statusMessage.text}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 rounded-2xl bg-[#0A0A0A] px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? '저장 중...' : '저장'}
            </button>
            <button
              type="button"
              onClick={() => router.push('/my')}
              disabled={isSaving}
              className="flex-1 rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] px-5 py-3 text-sm font-semibold text-[#111111] transition hover:bg-white disabled:opacity-50"
            >
              취소
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}
