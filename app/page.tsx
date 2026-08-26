import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '../lib/supabase/server'

export default async function HomePage() {
  const supabase = await createServerSupabaseClient()

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (session?.user) {
    redirect('/home')
  }

  redirect('/login')
}