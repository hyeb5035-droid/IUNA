"use client"

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)

export default function LogoutPage() {
  const router = useRouter()
  const [status, setStatus] = useState('로그아웃 처리 중입니다...')

  useEffect(() => {
    const signOut = async () => {
      const { error } = await supabase.auth.signOut()
      if (error) {
        setStatus('로그아웃 중 오류가 발생했습니다. 다시 시도해주세요.')
        return
      }

      router.replace('/login')
    }

    signOut()
  }, [router])

  return (
    <main className="min-h-screen bg-[#F5F4F1] px-6 py-16 text-[#111111]">
      <div className="mx-auto max-w-xl rounded-3xl bg-white border border-[#DDDCD7] p-10 shadow-sm">
        <h1 className="text-3xl font-semibold">로그아웃</h1>
        <p className="mt-4 text-slate-600">{status}</p>
      </div>
    </main>
  )
}
