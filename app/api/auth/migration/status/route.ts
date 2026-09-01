import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '../../../../../lib/supabase/server'
import { createAdminSupabaseClient } from '../../../../../lib/supabase/admin'

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  const admin = createAdminSupabaseClient()
  const { data, error } = await admin.auth.admin.getUserById(userData.user.id)
  if (error || !data.user) return NextResponse.json({ error: '상태 확인에 실패했습니다.' }, { status: 500 })
  const metadata = (data.user.user_metadata ?? {}) as Record<string, unknown>
  return NextResponse.json({
    email_pending: metadata.migration_email_pending === true,
    must_change_password: metadata.must_change_password === true,
  })
}
