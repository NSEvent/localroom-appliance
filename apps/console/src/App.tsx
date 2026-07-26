// Routing by parsing location.pathname manually (no router):
//   /console/                     → resume live room or host setup
//   /console/session/{id}         → live console / end review
//   /console/session/{id}?presenter=1 → presenter controls

import { useCallback, useEffect, useState } from 'react'
import * as api from './api'
import { isDemo, usePresenterKeys } from './clock.ts'
import { ClockHud } from './components/ClockHud'
import { Console } from './components/Console'
import { HostSetup } from './components/HostSetup'
import { PresenterControls } from './components/PresenterControls'
import { SessionProvider } from './store'

type Theme = 'dark' | 'light'

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() =>
    localStorage.getItem('localroom-theme') === 'light' ? 'light' : 'dark',
  )
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('localroom-theme', theme)
  }, [theme])
  return [theme, setThemeState]
}

interface Route {
  name: 'setup' | 'console' | 'presenter' | 'unknown'
  sessionId?: string
  /** ?clockhud=1 — dev-only virtual-clock readout. */
  hud?: boolean
}

function parseRoute(pathname: string, search: string): Route {
  pathname = pathname.replace(/^\/console(?=\/|$)/, '') || '/'
  if (pathname === '/' || pathname === '' || pathname === '/host') {
    return { name: 'setup' }
  }
  const m = pathname.match(/^\/session\/([^/]+)\/?$/)
  if (m) {
    const q = new URLSearchParams(search)
    const presenter = q.get('presenter') === '1'
    return {
      name: presenter ? 'presenter' : 'console',
      sessionId: m[1],
      hud: q.get('clockhud') === '1',
    }
  }
  return { name: 'unknown' }
}

/** Lane E renders nothing on the projector. Its only surface is the presenter
 * keyboard (demo mode only) and an opt-in debug HUD. Mode was fixed at boot in
 * main.tsx, so `isDemo()` is stable for the life of the page. */
function ClockStage({ hud }: { hud: boolean }) {
  const demo = isDemo()
  usePresenterKeys(demo)
  return hud ? <ClockHud /> : null
}

function ConsoleLanding({
  navigate,
  theme,
  setTheme,
}: {
  navigate: (path: string) => void
  theme: Theme
  setTheme: (theme: Theme) => void
}) {
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let cancelled = false
    api.getCurrentSession()
      .then(({ session }) => {
        if (cancelled) return
        if (session?.id) navigate(`/session/${session.id}`)
        else setChecking(false)
      })
      .catch(() => {
        if (!cancelled) setChecking(false)
      })
    return () => { cancelled = true }
  }, [navigate])

  return checking
    ? <div className="centered-note">Looking for a live room…</div>
    : <HostSetup navigate={navigate} theme={theme} setTheme={setTheme} />
}

export default function App() {
  const [theme, setTheme] = useTheme()
  const [route, setRoute] = useState<Route>(() =>
    parseRoute(location.pathname, location.search),
  )

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(location.pathname, location.search))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((path: string) => {
    const target = path.startsWith('/console') ? path : `/console${path}`
    history.pushState(null, '', target)
    const [pathname, search = ''] = target.split('?')
    setRoute(parseRoute(pathname, search ? `?${search}` : ''))
  }, [])

  switch (route.name) {
    case 'setup':
      return location.pathname === '/console/host'
        ? <HostSetup navigate={navigate} theme={theme} setTheme={setTheme} />
        : <ConsoleLanding navigate={navigate} theme={theme} setTheme={setTheme} />
    case 'console':
      return (
        <SessionProvider sessionId={route.sessionId!}>
          <div className="app">
            <Console />
            <ClockStage hud={!!route.hud} />
          </div>
        </SessionProvider>
      )
    case 'presenter':
      return (
        <SessionProvider sessionId={route.sessionId!}>
          <div className="app">
            <PresenterControls />
            <ClockStage hud={!!route.hud} />
          </div>
        </SessionProvider>
      )
    default:
      return (
        <div className="app">
          <div className="centered-note">
            Nothing here. <a href="/console/">Back to host setup</a>.
          </div>
        </div>
      )
  }
}
