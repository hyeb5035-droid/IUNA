import { notFound, redirect } from 'next/navigation'
import { createServerSupabaseClient } from '../../../../../lib/supabase/server'
import { getCurrentMemberAuth } from '../../../../../lib/supabase/auth'
import AttendanceClient from './AttendanceClient'

export const dynamic = 'force-dynamic'

export type ParticipantRow = {
  applicant_id: string
  legal_name: string | null
  profile_image_path: string | null
  company_name: string | null
  job_title: string | null
  grade: string
  application_type: string
  completed: boolean | null
}

export default async function AttendancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const auth = await getCurrentMemberAuth()
  if (!auth.session?.user) {
    redirect('/login')
  }

  const userId = auth.session.user.id
  const supabase = await createServerSupabaseClient()

  const { data: meeting } = await supabase
    .from('meetings')
    .select('id, title, status, created_by')
    .eq('id', id)
    .is('deleted_at', null)
    .single()

  if (!meeting) notFound()

  if (meeting.created_by !== userId) {
    redirect(`/meetings/${id}`)
  }

  if (meeting.status !== 'active') {
    redirect(`/meetings/${id}`)
  }

  // Fetch approved participants
  const { data: applications } = await supabase
    .from('meeting_applications')
    .select('applicant_id, application_type, completed')
    .eq('meeting_id', id)
    .eq('status', 'approved')

  const applicantIds = (applications ?? []).map((a) => a.applicant_id)
  let profileMap: Record<string, { legal_name: string | null; profile_image_path: string | null; company_name: string | null; job_title: string | null; grade: string }> = {}

  if (applicantIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, profile_image_path, company_name, job_title, profile_private!inner(legal_name), memberships!inner(grade)')
      .in('id', applicantIds)

    for (const p of (profiles ?? [])) {
      const priv = Array.isArray(p.profile_private) ? p.profile_private[0] : p.profile_private
      const membership = Array.isArray(p.memberships) ? p.memberships[0] : p.memberships
      profileMap[p.id] = {
        legal_name: (priv as any)?.legal_name ?? null,
        profile_image_path: p.profile_image_path ?? null,
        company_name: p.company_name ?? null,
        job_title: p.job_title ?? null,
        grade: (membership as any)?.grade ?? '',
      }
    }
  }

  const participants: ParticipantRow[] = (applications ?? []).map((a) => {
    const profile = profileMap[a.applicant_id] ?? { legal_name: null, profile_image_path: null, company_name: null, job_title: null, grade: '' }
    return {
      applicant_id: a.applicant_id,
      legal_name: profile.legal_name,
      profile_image_path: profile.profile_image_path,
      company_name: profile.company_name,
      job_title: profile.job_title,
      grade: profile.grade,
      application_type: a.application_type,
      completed: a.completed,
    }
  })

  return (
    <main className="min-h-screen bg-[#F5F4F1] px-4 py-12 text-[#111111] sm:px-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="rounded-3xl bg-white border border-[#DDDCD7] p-8 shadow-sm">
          <h1 className="text-2xl font-semibold">출석/완료 관리</h1>
          <p className="mt-1 text-sm text-slate-500">{meeting.title} · {participants.length}명 참여</p>
        </div>
        <AttendanceClient meetingId={id} participants={participants} />
      </div>
    </main>
  )
}
