'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type SidebarSection = {
  title?: string
  items: Array<{
    href: string
    label: string
    activePattern?: string
  }>
}

interface DesktopSidebarProps {
  isOperator?: boolean
  canManageMembers?: boolean
  canManageMeetings?: boolean
}

export default function DesktopSidebar({
  isOperator = false,
  canManageMembers = false,
  canManageMeetings = false,
}: DesktopSidebarProps) {
  const pathname = usePathname()

  const sections: SidebarSection[] = [
    {
      title: 'MEMBER',
      items: [
        { href: '/home', label: '홈', activePattern: '/home' },
        { href: '/meetings', label: '모임', activePattern: '/meetings' },
        { href: '/my', label: '마이', activePattern: '/my' },
      ],
    },
  ]

  if (isOperator) {
    const operatorItems = [
      { href: '/admin', label: '관리 홈', activePattern: '/admin' },
    ]

    // Add member management for all operators per v1.4 spec
    operatorItems.push({
      href: '/admin/members',
      label: '회원 조회',
      activePattern: '/admin/members',
    })

    // Meeting approval only for meeting_admin and super_admin
    if (canManageMeetings) {
      operatorItems.push({
        href: '/admin/meetings',
        label: '모임 승인',
        activePattern: '/admin/meetings',
      })
    }

    sections.push({
      title: 'OPERATOR',
      items: operatorItems,
    })
  }

  const isActive = (pattern?: string) => {
    if (!pattern) return false
    if (pattern === pathname) return true
    if (pattern.endsWith('/') && pathname.startsWith(pattern)) return true
    if (pattern.includes('[id]')) {
      const basePattern = pattern.replace('/[id]', '')
      return pathname.startsWith(basePattern) && pathname !== basePattern
    }
    return false
  }

  return (
    <aside className="hidden lg:flex lg:flex-col lg:w-56 lg:fixed lg:inset-y-0 lg:left-0 lg:z-40">
      <div className="flex flex-col h-full bg-white border-r border-[#E5E1DA]">
        {/* Brand */}
        <div className="px-5 py-6">
          <Link href="/home" className="text-xl font-black tracking-widest text-[#111111]">
            IUNA
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-2 space-y-6 overflow-y-auto">
          {sections.map((section) => (
            <div key={section.title || 'member'}>
              {section.title && (
                <h3 className="px-3 mb-2 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                  {section.title}
                </h3>
              )}
              <ul className="space-y-1">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`block px-3 py-2.5 rounded-xl text-sm font-semibold transition ${
                        isActive(item.activePattern)
                          ? 'bg-[#111111] text-white'
                          : 'text-slate-500 hover:bg-[#F5F4F1] hover:text-[#111111]'
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    </aside>
  )
}