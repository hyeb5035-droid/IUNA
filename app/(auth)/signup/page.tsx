"use client"

import { useEffect, useMemo, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type FormState = {
  email: string
  password: string
  confirmPassword: string
  name: string
  companyName: string
  jobTitle: string
  introduction: string
  interests: string
  agreeAll: boolean
  agreeTerms: boolean
  agreePrivacy: boolean
}

type FieldErrors = Partial<Record<keyof FormState, string>>

const initialState: FormState = {
  email: '',
  password: '',
  confirmPassword: '',
  name: '',
  companyName: '',
  jobTitle: '',
  introduction: '',
  interests: '',
  agreeAll: false,
  agreeTerms: false,
  agreePrivacy: false,
}

function validateEmail(value: string) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)
}

function validatePassword(value: string) {
  return value.length >= 6 && /^[0-9]+$/.test(value)
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)

export default function SignupPage() {
  const router = useRouter()
  const [formState, setFormState] = useState<FormState>(initialState)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)

  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession()
      if (data.session?.user) {
        router.replace('/home')
      }
    }

    checkSession()
  }, [router])

  const isAgreed = formState.agreeTerms && formState.agreePrivacy

  const canSubmit = useMemo(
    () =>
      formState.email.trim() !== '' &&
      formState.password.trim() !== '' &&
      formState.confirmPassword.trim() !== '' &&
      formState.name.trim() !== '' &&
      isAgreed &&
      !isSubmitting,
    [formState, isAgreed, isSubmitting],
  )

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setFormState((prev) => ({ ...prev, [field]: value }))
  }

  function validateAll() {
    const nextErrors: FieldErrors = {}

    if (!formState.email.trim()) {
      nextErrors.email = '이메일을 입력해주세요.'
    } else if (!validateEmail(formState.email.trim())) {
      nextErrors.email = '올바른 이메일 형식이 필요합니다.'
    }

    if (!formState.password.trim()) {
      nextErrors.password = '비밀번호를 입력해주세요.'
    } else if (!validatePassword(formState.password.trim())) {
      nextErrors.password = '비밀번호는 숫자만 6자리 이상이어야 합니다.'
    }

    if (!formState.confirmPassword.trim()) {
      nextErrors.confirmPassword = '비밀번호 확인을 입력해주세요.'
    } else if (formState.password !== formState.confirmPassword) {
      nextErrors.confirmPassword = '비밀번호가 일치하지 않습니다.'
    }

    if (!formState.name.trim()) {
      nextErrors.name = '이름을 입력해주세요.'
    }

    if (!formState.agreeTerms || !formState.agreePrivacy) {
      nextErrors.agreeAll = '필수 약관에 모두 동의해야 합니다.'
    }

    setErrors(nextErrors)
    return nextErrors
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatusMessage(null)
    const nextErrors = validateAll()
    if (Object.keys(nextErrors).length > 0) {
      return
    }

    setIsSubmitting(true)

    const interestsArray = formState.interests
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)

    const redirectTo = `${window.location.origin}/auth/callback`
    const { data, error } = await supabase.auth.signUp({
      email: formState.email.trim(),
      password: formState.password.trim(),
      options: {
        emailRedirectTo: redirectTo,
        data: {
          legal_name: formState.name.trim(),
          company_name: formState.companyName.trim(),
          job_title: formState.jobTitle.trim(),
          introduction: formState.introduction.trim(),
          interests: interestsArray,
        },
      },
    })

    if (error) {
      setIsSubmitting(false)
      const normalized = error.message.toLowerCase()
      const message = normalized.includes('duplicate') || normalized.includes('already')
        ? '이미 가입된 이메일입니다.'
        : normalized.includes('invalid email') || normalized.includes('invalid')
        ? '이메일 형식이 올바르지 않습니다.'
        : '가입 중 오류가 발생했습니다. 다시 시도해주세요.'
      setStatusMessage(message)
      return
    }

    setIsSubmitting(false)
    setIsSuccess(true)
  }

  if (isSuccess) {
    return (
      <main className="min-h-screen bg-[#F5F4F1] px-6 py-16 text-[#111111]">
        <div className="mx-auto max-w-xl rounded-3xl bg-white border border-[#DDDCD7] p-10 shadow-sm">
          <h1 className="text-3xl font-semibold">가입 신청 완료</h1>
          <p className="mt-4 text-slate-600">
            가입 신청이 완료되었습니다. 입력한 이메일에서 인증 링크를 확인해주세요.
          </p>
          <div className="mt-8 space-y-4">
            <div className="rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] p-5">
              <p className="text-sm text-slate-700">이메일 인증 후 로그인이 가능합니다.</p>
            </div>
            <Link
              href="/login"
              className="inline-flex w-full items-center justify-center rounded-2xl bg-[#0A0A0A] px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-900"
            >
              로그인 페이지로 이동
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#F5F4F1] px-6 py-16 text-[#111111]">
      <div className="mx-auto max-w-xl rounded-3xl bg-white border border-[#DDDCD7] p-6 shadow-sm sm:p-10">
        <h1 className="text-3xl font-semibold">회원가입</h1>
        <p className="mt-3 text-slate-600">IUNA 계정으로 가입하시려면 아래 정보를 입력해주세요.</p>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium">이메일</label>
              <input
                type="email"
                value={formState.email}
                onChange={(event) => updateField('email', event.target.value)}
                className="w-full rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] px-4 py-3 text-sm outline-none focus:border-[#0A0A0A]"
              />
              {errors.email ? <p className="mt-1 text-sm text-red-500">{errors.email}</p> : null}
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">비밀번호</label>
              <input
                type="password"
                value={formState.password}
                onChange={(event) => updateField('password', event.target.value)}
                className="w-full rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] px-4 py-3 text-sm outline-none focus:border-[#0A0A0A]"
              />
              {errors.password ? <p className="mt-1 text-sm text-red-500">{errors.password}</p> : null}
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">비밀번호 확인</label>
              <input
                type="password"
                value={formState.confirmPassword}
                onChange={(event) => updateField('confirmPassword', event.target.value)}
                className="w-full rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] px-4 py-3 text-sm outline-none focus:border-[#0A0A0A]"
              />
              {errors.confirmPassword ? <p className="mt-1 text-sm text-red-500">{errors.confirmPassword}</p> : null}
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">이름</label>
              <input
                type="text"
                value={formState.name}
                onChange={(event) => updateField('name', event.target.value)}
                className="w-full rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] px-4 py-3 text-sm outline-none focus:border-[#0A0A0A]"
              />
              {errors.name ? <p className="mt-1 text-sm text-red-500">{errors.name}</p> : null}
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">소속 / 회사명</label>
              <input
                type="text"
                value={formState.companyName}
                onChange={(event) => updateField('companyName', event.target.value)}
                className="w-full rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] px-4 py-3 text-sm outline-none focus:border-[#0A0A0A]"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">직무 / 직업</label>
              <input
                type="text"
                value={formState.jobTitle}
                onChange={(event) => updateField('jobTitle', event.target.value)}
                className="w-full rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] px-4 py-3 text-sm outline-none focus:border-[#0A0A0A]"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">자기소개</label>
              <textarea
                rows={4}
                value={formState.introduction}
                onChange={(event) => updateField('introduction', event.target.value)}
                className="w-full rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] px-4 py-3 text-sm outline-none focus:border-[#0A0A0A]"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">관심사</label>
              <input
                type="text"
                value={formState.interests}
                onChange={(event) => updateField('interests', event.target.value)}
                placeholder="쉼표로 구분하여 입력 예: 음악, 여행"
                className="w-full rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] px-4 py-3 text-sm outline-none focus:border-[#0A0A0A]"
              />
            </div>
          </div>

          <div className="rounded-3xl border border-[#DDDCD7] bg-[#F5F4F1] p-5">
            <div className="flex items-center gap-3">
              <input
                id="agreeAll"
                type="checkbox"
                checked={formState.agreeAll}
                onChange={(event) => {
                  const nextValue = event.target.checked
                  setFormState((prev) => ({
                    ...prev,
                    agreeAll: nextValue,
                    agreeTerms: nextValue,
                    agreePrivacy: nextValue,
                  }))
                  setErrors((prev) => ({ ...prev, agreeAll: undefined }))
                }}
                className="h-5 w-5 rounded border-[#DDDCD7] bg-white text-[#0A0A0A]"
              />
              <label htmlFor="agreeAll" className="text-sm font-medium">모든 약관에 동의합니다.</label>
            </div>
            <div className="mt-4 space-y-3 text-sm text-slate-700">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={formState.agreeTerms}
                  onChange={(event) => {
                    const nextValue = event.target.checked
                    setFormState((prev) => ({
                      ...prev,
                      agreeTerms: nextValue,
                      agreeAll: nextValue && prev.agreePrivacy,
                    }))
                    setErrors((prev) => ({ ...prev, agreeAll: undefined }))
                  }}
                  className="h-4 w-4 rounded border-[#DDDCD7] bg-white text-[#0A0A0A]"
                />
                <span>
                  <Link href="/terms" className="font-medium text-[#0A0A0A] underline">이용약관</Link> 동의 (필수)
                </span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={formState.agreePrivacy}
                  onChange={(event) => {
                    const nextValue = event.target.checked
                    setFormState((prev) => ({
                      ...prev,
                      agreePrivacy: nextValue,
                      agreeAll: nextValue && prev.agreeTerms,
                    }))
                    setErrors((prev) => ({ ...prev, agreeAll: undefined }))
                  }}
                  className="h-4 w-4 rounded border-[#DDDCD7] bg-white text-[#0A0A0A]"
                />
                <span>
                  <Link href="/privacy" className="font-medium text-[#0A0A0A] underline">개인정보 수집 및 이용</Link> 동의 (필수)
                </span>
              </label>
            </div>
            {errors.agreeAll ? <p className="mt-3 text-sm text-red-500">{errors.agreeAll}</p> : null}
          </div>

          {statusMessage ? <p className="text-sm text-red-500">{statusMessage}</p> : null}

          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex w-full items-center justify-center rounded-2xl bg-[#0A0A0A] px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? '가입 중...' : '가입하기'}
          </button>
        </form>
      </div>
    </main>
  )
}
