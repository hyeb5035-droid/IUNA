'use client'

import { createContext, useContext, ReactNode } from 'react'

type AuthContextType = {
  isOperator: boolean
  isSuperAdmin: boolean
  canManageMembers: boolean
  canManageMeetings: boolean
  memberNo?: string | null
  memberGrade?: string | null
}

const AuthContext = createContext<AuthContextType>({
  isOperator: false,
  isSuperAdmin: false,
  canManageMembers: false,
  canManageMeetings: false,
})

export function useAuthContext() {
  return useContext(AuthContext)
}

interface AuthProviderProps {
  children: ReactNode
  isOperator: boolean
  isSuperAdmin: boolean
  memberNo?: string | null
  memberGrade?: string | null
  activeRoles?: Array<{ code: string }>
}

export default function AuthProvider({
  children,
  isOperator,
  isSuperAdmin,
  memberNo,
  memberGrade,
  activeRoles = [],
}: AuthProviderProps) {
  const canManageMembers = isSuperAdmin || activeRoles.some((r) => r.code === 'member_admin')
  const canManageMeetings = isSuperAdmin || activeRoles.some((r) => r.code === 'meeting_admin')

  return (
    <AuthContext.Provider
      value={{
        isOperator,
        isSuperAdmin,
        canManageMembers,
        canManageMeetings,
        memberNo,
        memberGrade,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}