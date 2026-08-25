'use client'

import Link from 'next/link'

interface PageHeaderProps {
  title: string
  showBack?: boolean
  backHref?: string
  backLabel?: string
  rightAction?: React.ReactNode
}

export default function PageHeader({
  title,
  showBack = false,
  backHref,
  backLabel = '뒤로',
  rightAction,
}: PageHeaderProps) {
  const defaultBackHref = typeof window !== 'undefined' 
    ? window.history.length > 1 
      ? undefined // will use router.back()
      : '/home'
    : '/home'

  return (
    <header className="sticky top-0 z-30 bg-[#F7F6F2]/95 backdrop-blur-sm border-b border-[#E5E1DA]">
      <div className="flex items-center justify-between h-14 px-4">
        <div className="flex items-center gap-2">
          {showBack && (
            backHref ? (
              <Link
                href={backHref}
                className="flex items-center gap-1 text-sm text-slate-500 hover:text-[#111111] transition"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                {backLabel}
              </Link>
            ) : (
              <button
                onClick={() => window.history.back()}
                className="flex items-center gap-1 text-sm text-slate-500 hover:text-[#111111] transition"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                {backLabel}
              </button>
            )
          )}
          {!showBack && (
            <Link href="/home" className="text-lg font-bold tracking-widest text-[#111111]">
              IUNA
            </Link>
          )}
        </div>
        
        <h1 className={`font-semibold text-[#111111] ${showBack ? 'text-base' : 'text-lg'}`}>
          {title}
        </h1>
        
        <div className="flex items-center">
          {rightAction || <div className="w-14" />}
        </div>
      </div>
    </header>
  )
}