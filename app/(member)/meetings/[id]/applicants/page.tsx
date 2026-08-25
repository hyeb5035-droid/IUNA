import { notFound, redirect } from 'next/navigation'
import { createServerSupabaseClient } from '../../../../../lib/supabase/server'
import { getCurrentMemberAuth } from '../../../../../lib/supabase/auth'
import ApplicantListClient from './ApplicantListClient'

export const dynamic = 'force-dynamic'

export type ApplicantRow = {
  id: string
  applicant_id: string
  member_no: string
  legal_name: string | null
  grade: string
  company_name: string | null
  job_title: string | null
  status: string
  rejection_reason: string | null
  created_at: string
}

export default async function ApplicantsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const auth = await getCurrentMemberAuth()
  if (!auth.session?.user) {
    redirect('/login')
  }

  const userId = auth.session.user.id
  const supabase = await createServerSupabaseClient()

  // Verify meeting exists
  const { data: meeting } = await supabase
    .from('meetings')
    .select('id, title, created_by, status')
    .eq('id', id)
    .is('deleted_at', null)
    .single()

  if (!meeting) {
    notFound()
  }

  // Check management permission — creator only
  const isCreator = meeting.created_by === userId

  if (!isCreator) {
    redirect(`/meetings/${id}`)
  }

  // Fetch applicants with profile info
  const { data: applications } = await supabase
    .from('meeting_applications')
    .select('id, applicant_id, status, rejection_reason, created_at')
    .eq('meeting_id', id)
    .order('created_at', { ascending: true })

  // Fetch applicant profiles
  const applicantIds = (applications ?? []).map((a) => a.applicant_id)
  let profileMap: Record<string, { member_no: string; legal_name: string | null; grade: string; company_name: string | null; job_title: string | null }> = {}

  if (applicantIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, member_no, company_name, job_title, profile_private!inner(legal_name), memberships!inner(grade)')
      .in('id', applicantIds)

    for (const p of (profiles ?? [])) {
      const priv = Array.isArray(p.profile_private) ? p.profile_private[0] : p.profile_private
      const membership = Array.isArray(p.memberships) ? p.memberships[0] : p.memberships
      profileMap[p.id] = {
        member_no: p.member_no,
        legal_name: (priv as any)?.legal_name ?? null,
        grade: (membership as any)?.grade ?? '',
        company_name: p.company_name ?? null,
        job_title: p.job_title ?? null,
      }
    }
  }

  const applicants: ApplicantRow[] = (applications ?? []).map((a) => {
    const profile = profileMap[a.applicant_id] ?? { member_no: '', legal_name: null, grade: '', company_name: null, job_title: null }
    return {
      id: a.id,
      applicant_id: a.applicant_id,
      member_no: profile.member_no,
      legal_name: profile.legal_name,
      grade: profile.grade,
      company_name: profile.company_name,
      job_title: profile.job_title,
      status: a.status,
      rejection_reason: a.rejection_reason,
      created_at: a.created_at,
    }
  })

  return (
    <main className="min-h-screen bg-[#F5F4F1] px-4 py-12 text-[#111111] sm:px-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="rounded-3xl bg-white border border-[#DDDCD7] p-8 shadow-sm">
          <h1 className="text-2xl font-semibold">신청자 관리</h1>
          <p className="mt-1 text-sm text-slate-500">{meeting.title} · {applicants.length}명 신청</p>
        </div>
        <ApplicantListClient applicants={applicants} meetingStatus={meeting.status} />
      </div>
    </main>
  )
}
