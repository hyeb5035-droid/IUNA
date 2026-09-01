import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '../../../../../lib/supabase/server'
import { createAdminSupabaseClient } from '../../../../../lib/supabase/admin'

export async function POST() {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  const admin = createAdminSupabaseClient()
  const { data: current, error: readError } = await admin.auth.admin.getUserById(data.user.id)
  if (readError || !current.user) return NextResponse.json({ error: '계정 확인에 실패했습니다.' }, { status: 500 })
  const metadata = (current.user.user_metadata ?? {}) as Record<string, unknown>
  const { error } = await admin.auth.admin.updateUserById(data.user.id, {
    user_metadata: {
      ...metadata,
      must_change_password: false,
      migration_password_changed_at: new Date().toISOString(),
    },
  })

  if (error) return NextResponse.json({ error: '변경 상태 저장에 실패했습니다.' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
