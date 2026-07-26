// Routing by parsing location.pathname manually (no router):
//   /                     → host setup
//   /session/{id}         → live console / end review
//   /session/{id}?presenter=1 → presenter controls (never on the projector)

import { useEffect, useState } from 'react'
import { Console } from './components/Console'
import { HostSetup } from './components/HostSetup'
import { JoinPage } from './components/JoinPage'
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
  /** Present when a participant joined from their own device. */
  sourceId?: string | null
}

function parseRoute(pathname: string, search: string): Route {
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
      sourceId: q.get('source'),
    }
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

  switch (route.name) {
    case 'setup':
      // Anyone opening the box's address lands here: it shows whether a
      // meeting is live and lets them claim a name before streaming. The
      // host's own setup screen is at /host.
      return location.pathname === '/host'
        ? <HostSetup navigate={navigate} theme={theme} setTheme={setTheme} />
        : <JoinPage navigate={navigate} />
    case 'console':
      return (
        <SessionProvider sessionId={route.sessionId!} sourceId={route.sourceId}>
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
