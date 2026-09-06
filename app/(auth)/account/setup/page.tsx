'use client'

import { createBrowserClient } from '@supabase/ssr'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
)

export default function AccountSetupPage() {
  const router = useRouter()
  const [emailPending, setEmailPending] = useState(false)
  const [passwordPending, setPasswordPending] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)

  async function loadStatus() {
    const response = await fetch('/api/auth/migration/status', { cache: 'no-store' })
    if (!response.ok) {
      router.replace('/login')
      return
    }
    const status = await response.json()
    setEmailPending(Boolean(status.email_pending))
    setPasswordPending(Boolean(status.must_change_password))
    setLoading(false)
    if (!status.email_pending && !status.must_change_password) router.replace('/home')
  }

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('email') === 'verified') {
      setMessage('이메일 인증이 완료되었습니다.')
    }
    void loadStatus()
  }, [])

  async function submitEmail(event: React.FormEvent) {
    event.preventDefault()
    setMessage('')
    const trimmed = email.trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(trimmed)) {
      setMessage('올바른 이메일을 입력해 주세요.')
      return
    }
    const { error } = await supabase.auth.updateUser(
      { email: trimmed },
      { emailRedirectTo: `${window.location.origin}/auth/callback` },
    )
    setMessage(error ? '이메일 등록에 실패했습니다.' : '인증 메일을 보냈습니다. 메일의 링크를 눌러 주세요.')
  }

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault()
    setMessage('')
    if (password.length < 8) {
      setMessage('새 비밀번호는 8자 이상이어야 합니다.')
      return
    }
    if (password !== passwordConfirm) {
      setMessage('비밀번호 확인이 일치하지 않습니다.')
      return
    }
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setMessage('비밀번호 변경에 실패했습니다.')
      return
    }
    const response = await fetch('/api/auth/migration/complete-password', { method: 'POST' })
    if (!response.ok) {
      setMessage('변경 상태 저장에 실패했습니다. 다시 시도해 주세요.')
      return
    }
    setPasswordPending(false)
    setPassword('')
    setPasswordConfirm('')
    setMessage('비밀번호가 변경되었습니다.')
    await loadStatus()
  }

  if (loading) return <main className="min-h-screen bg-[#F5F4F1] p-8">계정 상태를 확인하고 있습니다.</main>

  return (
    <main className="iuna-page">
      <div className="iuna-card-emphasis mx-auto max-w-xl p-6 sm:p-8">
        <h1 className="iuna-page-title">계정 보안 설정</h1>
        <p className="mt-3 text-sm text-slate-600">기존 회원 정보 이관 후 최초 1회 필요한 절차입니다.</p>
        {emailPending ? (
          <form className="mt-8 space-y-3" onSubmit={submitEmail}>
            <h2 className="text-lg font-semibold">이메일 등록 및 인증</h2>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" className="iuna-field" />
            <button className="iuna-primary w-full">인증 메일 보내기</button>
          </form>
        ) : null}
        {passwordPending ? (
          <form className="mt-8 space-y-3" onSubmit={submitPassword}>
            <h2 className="text-lg font-semibold">초기 비밀번호 변경</h2>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="새 비밀번호 (8자 이상)" className="iuna-field" />
            <input type="password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} placeholder="새 비밀번호 확인" className="iuna-field" />
            <button className="iuna-primary w-full">비밀번호 변경</button>
          </form>
        ) : null}
        {message ? <p className="mt-5 text-sm text-slate-700">{message}</p> : null}
      </div>
    </main>
  )
}
