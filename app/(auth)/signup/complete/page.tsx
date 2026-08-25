"use client"

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function SignupCompleteContent() {
  const searchParams = useSearchParams()
  const memberNo = searchParams.get('member_no')
  const errorParam = searchParams.get('error')
  const hasError = errorParam === 'member_no_unavailable' || errorParam === 'profile_save_failed'

  if (hasError || !memberNo) {
    const message =
      errorParam === 'profile_save_failed'
        ? '이메일 인증은 완료되었으나 프로필 정보 저장에 실패했습니다. 로그인 후 마이페이지에서 정보를 직접 입력해주세요.'
        : '이메일 인증이 완료되었습니다. 회원번호 확인이 지연되고 있습니다. 잠시 후 로그인 후 관리자에게 문의해주세요.'

    return (
      <main className="min-h-screen bg-[#F5F4F1] px-6 py-16 text-[#111111]">
        <div className="mx-auto max-w-xl rounded-3xl bg-white border border-[#DDDCD7] p-10 shadow-sm">
          <h1 className="text-3xl font-semibold">가입 완료</h1>
          <p className="mt-4 text-slate-600">{message}</p>
          <div className="mt-8">
            <Link
              href="/login"
              className="inline-flex w-full items-center justify-center rounded-2xl bg-[#0A0A0A] px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-900"
            >
              로그인하기
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#F5F4F1] px-6 py-16 text-[#111111]">
      <div className="mx-auto max-w-xl rounded-3xl bg-white border border-[#DDDCD7] p-10 shadow-sm">
        <h1 className="text-3xl font-semibold">가입이 완료되었습니다.</h1>
        <p className="mt-3 text-slate-600">IUNA 회원이 되신 것을 환영합니다.</p>

        <div className="mt-8 rounded-2xl border border-[#DDDCD7] bg-[#F5F4F1] p-6">
          <p className="text-sm text-slate-500">회원번호</p>
          <p className="mt-1 text-4xl font-bold tracking-widest text-[#0A0A0A]">{memberNo}</p>
        </div>

        <p className="mt-6 text-sm text-slate-600">
          앞으로 회원번호와 비밀번호로 로그인해주세요.
        </p>

        <div className="mt-8">
          <Link
            href="/login"
            className="inline-flex w-full items-center justify-center rounded-2xl bg-[#0A0A0A] px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-900"
          >
            로그인하기
          </Link>
        </div>
      </div>
    </main>
  )
}

export default function SignupCompletePage() {
  return (
    <Suspense>
      <SignupCompleteContent />
    </Suspense>
  )
}
