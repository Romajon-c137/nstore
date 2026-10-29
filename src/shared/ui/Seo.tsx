'use client'

import { Children,isValidElement,type ReactNode } from 'react'

/** React 19 hoists title, meta and link elements to document.head. */
export function Helmet({ children }: { children: ReactNode }) {
  return <>{Children.map(children, child => isValidElement(child) && child.type === 'html' ? null : child)}</>
}
