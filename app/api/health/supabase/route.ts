import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    const { error } = await supabase.auth.getSession()

    if (error) {
      return NextResponse.json(
        { ok: false, error: 'Supabase connection failed' },
        { status: 502 },
      )
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Supabase connection failed' },
      { status: 502 },
    )
  }
}
