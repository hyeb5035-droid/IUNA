import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '../../../../lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()

  const { data: sessionData } = await supabase.auth.getSession()
  const user = sessionData?.session?.user ?? null

  if (!user) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }

  const raw = body as Record<string, unknown>

  // Accept only the four editable fields; ignore everything else
  const companyName = typeof raw.company_name === 'string' ? raw.company_name.trim() : null
  const jobTitle = typeof raw.job_title === 'string' ? raw.job_title.trim() : null
  const introduction = typeof raw.introduction === 'string' ? raw.introduction.trim() : null

  // interests: accept string (comma-separated) or string[]
  let interests: string[]
  if (Array.isArray(raw.interests)) {
    interests = raw.interests
      .map((i) => String(i).trim())
      .filter(Boolean)
  } else if (typeof raw.interests === 'string') {
    interests = raw.interests
      .split(',')
      .map((i) => i.trim())
      .filter(Boolean)
  } else {
    interests = []
  }

  const updatePayload: Record<string, unknown> = {
    company_name: companyName || null,
    job_title: jobTitle || null,
    introduction: introduction || null,
    interests,
  }

  // Update only the authenticated user's own row — RLS enforces id = auth.uid()
  const { error } = await supabase
    .from('profiles')
    .update(updatePayload)
    .eq('id', user.id)

  if (error) {
    console.error('[profile/update] update error:', error.code, error.message)
    return NextResponse.json({ error: '저장 중 오류가 발생했습니다. 다시 시도해주세요.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
