// Routing by parsing location.pathname manually (no router):
//   /                     → host setup
//   /session/{id}         → live console / end review
//   /session/{id}?presenter=1 → presenter controls (never on the projector)

import { useEffect, useState } from 'react'
import * as api from './api'
import { Console } from './components/Console'
import { HostSetup } from './components/HostSetup'
import { PresenterControls } from './components/PresenterControls'
import { SessionProvider } from './store'

type Theme = 'dark' | 'light'

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() =>
    localStorage.getItem('meety-theme') === 'light' ? 'light' : 'dark',
  )
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('meety-theme', theme)
  }, [theme])
  return [theme, setThemeState]
}

interface Route {
  name: 'setup' | 'console' | 'presenter' | 'unknown'
  sessionId?: string
}

function parseRoute(pathname: string, search: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'setup' }
  const m = pathname.match(/^\/session\/([^/]+)\/?$/)
  if (m) {
    const presenter = new URLSearchParams(search).get('presenter') === '1'
    return { name: presenter ? 'presenter' : 'console', sessionId: m[1] }
  }
  return { name: 'unknown' }
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

  const navigate = (path: string) => {
    history.pushState(null, '', path)
    const [pathname, search = ''] = path.split('?')
    setRoute(parseRoute(pathname, search ? `?${search}` : ''))
  }

  // One session at a time (appliance rule): if a meeting is already live,
  // landing on "/" joins it rather than offering to start a rival one. The
  // server enforces this too — this is just so the screen matches reality.
  useEffect(() => {
    if (route.name !== 'setup') return
    let cancelled = false
    void (async () => {
      try {
        const { session } = await api.getCurrentSession()
        if (!cancelled && session) navigate(`/session/${session.id}`)
      } catch {
        /* no server yet — stay on setup, it renders its own error */
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.name])

  switch (route.name) {
    case 'setup':
      return <HostSetup navigate={navigate} theme={theme} setTheme={setTheme} />
    case 'console':
      return (
        <SessionProvider sessionId={route.sessionId!}>
          <div className="app">
            <Console />
          </div>
        </SessionProvider>
      )
    case 'presenter':
      return (
        <SessionProvider sessionId={route.sessionId!}>
          <div className="app">
            <PresenterControls />
          </div>
        </SessionProvider>
      )
    default:
      return (
        <div className="app">
          <div className="centered-note">
            Nothing here. <a href="/">Back to host setup</a>.
          </div>
        </div>
      )
  }
}
