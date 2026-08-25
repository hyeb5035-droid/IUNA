import { redirect } from 'next/navigation'
import { getCurrentMemberAuth } from '../../lib/supabase/auth'
import AuthProvider from '../../components/ui/AuthProvider'
import AppShell from '../../components/ui/AppShell'

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const auth = await getCurrentMemberAuth()

  if (!auth.session?.user || !auth.profile || !auth.membership) {
    redirect('/login')
  }

  return (
    <AuthProvider
      isOperator={auth.isOperator}
      isSuperAdmin={auth.isSuperAdmin}
      memberNo={auth.profile?.member_no}
      memberGrade={auth.membership?.grade}
      activeRoles={auth.activeRoles}
    >
      <AppShell isOperator={auth.isOperator}>
        {children}
      </AppShell>
    </AuthProvider>
  )
}
