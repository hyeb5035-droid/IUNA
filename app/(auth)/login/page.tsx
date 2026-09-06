"use client"

import { useEffect, useMemo, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type FormState = {
  memberNo: string
  password: string
}

type FieldErrors = Partial<Record<keyof FormState, string>>

const initialState: FormState = {
  memberNo: '',
  password: '',
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)

function isValidMemberNo(value: string) {
  return /^[0-9]{5}$/.test(value.trim())
}

export default function LoginPage() {
  const router = useRouter()
  const [formState, setFormState] = useState<FormState>(initialState)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession()
      if (data.session?.user) {
        router.replace('/home')
      }
    }

    checkSession()
  }, [router])

  const canSubmit = useMemo(
    () => formState.memberNo.trim() !== '' && formState.password.trim() !== '' && !isSubmitting,
    [formState, isSubmitting],
  )

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setFormState((prev) => ({ ...prev, [field]: value }))
  }

  function validateAll() {
    const nextErrors: FieldErrors = {}

    if (!formState.memberNo.trim()) {
      nextErrors.memberNo = '회원번호를 입력해주세요.'
    } else if (!isValidMemberNo(formState.memberNo)) {
      nextErrors.memberNo = '회원번호는 숫자 5자리입니다.'
    }

    if (!formState.password.trim()) {
      nextErrors.password = '비밀번호를 입력해주세요.'
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

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_no: formState.memberNo.trim(),
          password: formState.password,
        }),
      })

      if (response.ok) {
        const result = await response.json() as {
          requires_email?: boolean
          requires_password_change?: boolean
        }
        router.replace(
          result.requires_email || result.requires_password_change ? '/account/setup' : '/home',
        )
        return
      }

      // All server-side failures surface as the same generic message
      setStatusMessage('회원번호 또는 비밀번호를 확인해주세요.')
    } catch {
      setStatusMessage('로그인 중 오류가 발생했습니다. 다시 시도해주세요.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="iuna-page flex items-center justify-center">
      <div className="iuna-card-emphasis w-full max-w-xl p-6 sm:p-10">
        <p className="iuna-eyebrow">IUNA COMMUNITY PLATFORM</p>
        <h1 className="iuna-page-title mt-2">로그인</h1>
        <p className="mt-3 text-slate-600">IUNA 계정으로 로그인하세요.</p>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium">회원번호</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={5}
                value={formState.memberNo}
                onChange={(event) => updateField('memberNo', event.target.value)}
                className="w-full rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] px-4 py-3 text-sm outline-none focus:border-[#0A0A0A]"
              />
              {errors.memberNo ? <p className="mt-1 text-sm text-red-500">{errors.memberNo}</p> : null}
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
          </div>

          {statusMessage ? <p className="text-sm text-red-500">{statusMessage}</p> : null}

          <button
            type="submit"
            disabled={!canSubmit}
            className="iuna-primary w-full"
          >
            {isSubmitting ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <div className="mt-6 text-sm text-slate-600">
          아직 계정이 없으신가요?{' '}
          <Link href="/signup" className="font-medium text-[#0A0A0A] underline">
            회원가입
          </Link>
        </div>
      </div>
    </main>
  )
}
