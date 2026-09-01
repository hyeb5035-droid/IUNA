import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '../../../../lib/supabase/admin'
import { createServerSupabaseClient } from '../../../../lib/supabase/server'

const GENERIC_ERROR = '회원번호 또는 비밀번호를 확인해주세요.'

function isValidMemberNo(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9]{5}$/.test(value.trim())
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 })
  }

  const raw = body as Record<string, unknown>
  const memberNo = typeof raw.member_no === 'string' ? raw.member_no.trim() : ''
  const password = typeof raw.password === 'string' ? raw.password : ''

  // Validate member_no format before any DB lookup
  if (!isValidMemberNo(memberNo) || !password) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 })
  }

  const adminClient = createAdminSupabaseClient()

  const { data: profileData, error: profileError } = await adminClient
    .from('profiles')
    .select('id')
    .eq('member_no', memberNo)
    .is('deleted_at', null)
    .single()

  if (profileError || !profileData) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 })
  }

  const userId = profileData.id

  const { data: adminUserData, error: adminUserError } = await adminClient
    .auth.admin.getUserById(userId)

  if (adminUserError || !adminUserData?.user?.email) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 })
  }

  const email = adminUserData.user.email

  const supabase = await createServerSupabaseClient()
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (signInError || !signInData.session) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 })
  }

  const metadata = (adminUserData.user.user_metadata ?? {}) as Record<string, unknown>

  return NextResponse.json({
    ok: true,
    requires_email: metadata.migration_email_pending === true,
    requires_password_change: metadata.must_change_password === true,
  })
}
