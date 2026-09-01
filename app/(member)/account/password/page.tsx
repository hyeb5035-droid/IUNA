'use client'

import { createBrowserSupabaseClient } from '../../../../lib/supabase/client'
import { useState } from 'react'

export default function PasswordChangePage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setMessage('')
    if (password.length < 8) {
      setMessage('비밀번호는 8자 이상이어야 합니다.')
      return
    }
    if (password !== confirm) {
      setMessage('비밀번호 확인이 일치하지 않습니다.')
      return
    }
    const { error } = await createBrowserSupabaseClient().auth.updateUser({ password })
    setMessage(error ? '비밀번호 변경에 실패했습니다.' : '비밀번호가 변경되었습니다.')
    if (!error) {
      setPassword('')
      setConfirm('')
    }
  }

  return (
    <div className="mx-auto max-w-xl py-8">
      <h1 className="text-2xl font-bold">비밀번호 변경</h1>
      <form onSubmit={submit} className="mt-6 space-y-4 rounded-2xl border border-[#DDDCD7] bg-white p-6">
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="새 비밀번호 (8자 이상)" className="w-full rounded-xl border px-4 py-3" />
        <input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="새 비밀번호 확인" className="w-full rounded-xl border px-4 py-3" />
        <button className="w-full rounded-xl bg-black px-4 py-3 font-semibold text-white">변경하기</button>
        {message ? <p className="text-sm text-slate-600">{message}</p> : null}
      </form>
    </div>
  )
}
