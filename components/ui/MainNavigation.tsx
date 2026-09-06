'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type NavigationItem = {
  href: string
  label: string
  icon: 'home' | 'meetings' | 'my' | 'admin'
  requiresOperator?: boolean
}

const navigationItems: NavigationItem[] = [
  { href: '/home', label: '홈', icon: 'home' },
  { href: '/meetings', label: '모임', icon: 'meetings' },
  { href: '/my', label: '마이', icon: 'my' },
  { href: '/admin', label: '관리', icon: 'admin', requiresOperator: true },
]

const iconMap = {
  home: (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  ),
  meetings: (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  my: (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  admin: (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
}

interface MainNavigationProps {
  isOperator?: boolean
}

export default function MainNavigation({ isOperator = false }: MainNavigationProps) {
  const pathname = usePathname()

  const filteredItems = navigationItems.filter(
    (item) => !item.requiresOperator || (item.requiresOperator && isOperator),
  )

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--iuna-line)] bg-white/95 backdrop-blur lg:hidden">
      <div className="flex items-center justify-around px-2 py-2 pb-safe">
        {filteredItems.map((item) => {
          const isActive = pathname === item.href || 
            (item.href !== '/home' && pathname.startsWith(item.href))

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-12 min-w-14 flex-col items-center gap-1 rounded-xl px-3 py-2 transition ${
                isActive
                  ? 'text-[var(--iuna-navy)] font-bold'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <span className={isActive ? 'text-[var(--iuna-navy)]' : 'text-slate-400'}>
                {iconMap[item.icon]}
              </span>
              <span className="text-[11px]">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
