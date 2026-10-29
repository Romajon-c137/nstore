'use client'

import NextLink from 'next/link'
import { usePathname,useRouter,useSearchParams } from 'next/navigation'
import { useCallback,useMemo,type CSSProperties,type ComponentProps } from 'react'

export { default as Link } from 'next/link'
export { useParams } from 'next/navigation'

/** Stable navigation callback for form handlers and auth subscriptions. */
export function useNavigate() {
  const router = useRouter()
  return useCallback((href: string, options?: { replace?: boolean }) => {
    if (options?.replace) router.replace(href)
    else router.push(href)
  }, [router])
}

export function useLocation() {
  const pathname = usePathname()
  return useMemo(() => ({ pathname }), [pathname])
}

/** App Router search params with an atomic updater, preserving other filters. */
export function useUrlQuery() {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const update = useCallback((next: URLSearchParams | ((prev: URLSearchParams) => URLSearchParams), options?: { replace?: boolean }) => {
    const current = new URLSearchParams(window.location.search)
    const value = typeof next === 'function' ? next(current) : next
    const query = value.toString()
    if (query === current.toString()) return
    const href = pathname + (query ? `?${query}` : '')
    if (options?.replace) router.replace(href, { scroll: false })
    else router.push(href, { scroll: false })
  }, [pathname, router])
  return [params, update] as const
}

type ActiveStyle = CSSProperties | ((state: { isActive: boolean }) => CSSProperties)
type Props = Omit<ComponentProps<typeof NextLink>, 'style'> & { style?: ActiveStyle }
export function NavLink({ href, style, ...props }: Props) {
  const pathname = usePathname()
  const active = pathname === href
  return <NextLink {...props} href={href} aria-current={active ? 'page' : undefined} style={typeof style === 'function' ? style({ isActive: active }) : style} />
}
