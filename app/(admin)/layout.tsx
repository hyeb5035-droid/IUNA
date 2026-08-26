import { redirect } from 'next/navigation'
import { getCurrentMemberAuth } from '../../lib/supabase/auth'
import AuthProvider from '../../components/ui/AuthProvider'
import AppShell from '../../components/ui/AppShell'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await getCurrentMemberAuth()

  if (!auth.session?.user) {
    redirect('/login')
  }

  if (!auth.isOperator) {
    redirect('/my')
  }

  const canManageMembers = auth.isSuperAdmin || auth.activeRoles.some((r) => r.code === 'member_admin')
  const canManageMeetings = auth.isSuperAdmin || auth.activeRoles.some((r) => r.code === 'meeting_admin')

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
