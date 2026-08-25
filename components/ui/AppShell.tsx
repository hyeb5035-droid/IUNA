'use client'

import { ReactNode } from 'react'
import MainNavigation from './MainNavigation'
import DesktopSidebar from './DesktopSidebar'
import { useAuthContext } from './AuthProvider'

interface AppShellProps {
  children: ReactNode
  hideNavigation?: boolean
}

export default function AppShell({ children, hideNavigation = false }: AppShellProps) {
  const { isOperator, canManageMembers, canManageMeetings } = useAuthContext()

  return (
    <div className="min-h-screen bg-[#F7F6F2]">
      {/* Desktop Sidebar */}
      <DesktopSidebar
        isOperator={isOperator}
        canManageMembers={canManageMembers}
        canManageMeetings={canManageMeetings}
      />

      {/* Main Content Area */}
      <div className="lg:pl-56">
        {/* Content */}
        <main className={`min-h-screen ${hideNavigation ? '' : 'pb-20 lg:pb-0'}`}>
          {children}
        </main>

        {/* Mobile Bottom Navigation */}
        {!hideNavigation && (
          <MainNavigation isOperator={isOperator} />
        )}
      </div>
    </div>
  )
}