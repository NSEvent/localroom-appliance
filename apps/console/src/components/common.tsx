import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { UpdatedAgo } from '../time'

/** Shared panel chrome: title, scrollable body, "updated X ago" footer. */
export function Panel({
  title,
  count,
  stamp,
  children,
  className,
  extra,
  bodyRef,
  onBodyScroll,
}: {
  title: string
  count?: number
  stamp: number | string | null
  children: ReactNode
  className?: string
  extra?: ReactNode
  bodyRef?: RefObject<HTMLDivElement | null>
  onBodyScroll?: () => void
}) {
  return (
    <section className={`panel ${className ?? ''}`}>
      <div className="panel-title">
        <span>{title}</span>
        {count !== undefined && <span className="count">{count}</span>}
        {extra}
      </div>
      <div className="panel-body" ref={bodyRef} onScroll={onBodyScroll}>
        {children}
      </div>
      <UpdatedAgo stamp={stamp} />
    </section>
  )
}

/** One quiet sentence, never a blank box (ui-spec §6). */
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Skeletons({ n = 3 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="skeleton" />
      ))}
    </>
  )
}

/** True for 300 ms after `value` changes — the single background flash on the
 * changed card only (ui-spec §3, keyed on updated_at). */
export function useFlashOnChange(value: string | null | undefined): boolean {
  const prev = useRef<string | null | undefined>(undefined)
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    const changed = prev.current !== undefined && prev.current !== value
    prev.current = value
    if (changed) {
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 320)
      return () => clearTimeout(t)
    }
  }, [value])
  return flash
}
