import { redirect } from 'next/navigation'
import { getCurrentMemberAuth } from '../../lib/supabase/auth'
import AuthProvider from '../../components/ui/AuthProvider'
import AppShell from '../../components/ui/AppShell'
import { createAdminSupabaseClient } from '../../lib/supabase/admin'

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const auth = await getCurrentMemberAuth()

  if (!auth.session?.user || !auth.profile || !auth.membership) {
    redirect('/login')
  }

  const admin = createAdminSupabaseClient()
  const { data: migratedUser } = await admin.auth.admin.getUserById(auth.session.user.id)
  const metadata = (migratedUser.user?.user_metadata ?? {}) as Record<string, unknown>
  if (metadata.migration_email_pending === true || metadata.must_change_password === true) {
    redirect('/account/setup')
  }

  return (
    <AuthProvider
      isOperator={auth.isOperator}
      isSuperAdmin={auth.isSuperAdmin}
      memberNo={auth.profile?.member_no}
      memberGrade={auth.membership?.grade}
      activeRoles={auth.activeRoles}
    >
      <AppShell>
        {children}
      </AppShell>
    </AuthProvider>
  )
}
