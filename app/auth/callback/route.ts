import { NextResponse } from 'next/server'
import { finalizeSignupProfile } from '../../../lib/supabase/auth'
import { createServerSupabaseClient } from '../../../lib/supabase/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const authCode = url.searchParams.get('code')

  if (!authCode) {
    return NextResponse.redirect(new URL('/auth/error?reason=invalid_token', request.url))
  }

  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(authCode)

  if (error || !data.session || !data.user) {
    return NextResponse.redirect(new URL('/auth/error?reason=verify_failed', request.url))
  }

  // Diagnostic: log metadata presence and finalize result (no sensitive values)
  const meta = data.user.user_metadata ?? {}
  console.log('[callback] user_metadata keys:', {
    has_legal_name: !!meta.legal_name,
    has_company_name: !!meta.company_name,
    has_job_title: !!meta.job_title,
    has_introduction: !!meta.introduction,
    has_interests: !!meta.interests,
    interests_type: typeof meta.interests,
    interests_is_array: Array.isArray(meta.interests),
    interests_length: Array.isArray(meta.interests) ? meta.interests.length : null,
  })

  const { updated, error: finalizeError } = await finalizeSignupProfile(supabase, data.user)
  console.log('[callback] finalizeSignupProfile result:', { updated, errorCode: finalizeError?.code, errorMsg: finalizeError?.message })

  if (finalizeError) {
    console.error('[callback] finalizeSignupProfile failed:', finalizeError?.code ?? finalizeError?.message ?? 'unknown')
    return NextResponse.redirect(new URL('/signup/complete?error=profile_save_failed', request.url))
  }

  // Fetch the DB-issued member number so the completion page can display it
  const { data: profileData } = await supabase
    .from('profiles')
    .select('member_no')
    .eq('id', data.user.id)
    .single()

  const memberNo = profileData?.member_no ?? null

  if (!memberNo) {
    // Profile exists but member_no not yet available — show safe recovery
    return NextResponse.redirect(new URL('/signup/complete?error=member_no_unavailable', request.url))
  }

  return NextResponse.redirect(
    new URL(`/signup/complete?member_no=${encodeURIComponent(memberNo)}`, request.url),
  )
}
