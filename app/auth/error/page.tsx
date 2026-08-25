import Link from 'next/link'

export default function AuthErrorPage({ searchParams }: { searchParams: { reason?: string } }) {
  const reason = searchParams.reason
  let title = '인증 오류'
  let message = '인증 링크가 잘못되었거나 만료되었습니다.'

  if (reason === 'invalid_token') {
    title = '인증 링크 오류'
    message = '인증 링크에 필요한 정보가 없습니다. 이메일의 링크를 다시 확인해주세요.'
  } else if (reason === 'verify_failed') {
    title = '인증 실패'
    message = '이메일 인증에 실패했습니다. 다시 로그인하거나 가입을 시도해주세요.'
  }

  return (
    <main className="min-h-screen bg-[#F5F4F1] px-6 py-16 text-[#111111]">
      <div className="mx-auto max-w-xl rounded-3xl bg-white border border-[#DDDCD7] p-10 shadow-sm">
        <h1 className="text-3xl font-semibold">{title}</h1>
        <p className="mt-4 text-slate-600">{message}</p>
        <div className="mt-8 space-y-4">
          <Link
            href="/login"
            className="inline-flex w-full items-center justify-center rounded-2xl bg-[#0A0A0A] px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-900"
          >
            로그인으로 이동
          </Link>
          <Link
            href="/signup"
            className="inline-flex w-full items-center justify-center rounded-2xl border border-[#DDDCD7] bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:bg-[#F5F4F1]"
          >
            회원가입으로 이동
          </Link>
        </div>
      </div>
    </main>
  )
}
