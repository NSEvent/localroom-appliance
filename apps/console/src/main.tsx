import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { enterDemoMode } from './clock.ts'
import './styles/app.css'

// Demo mode is a one-way, boot-time opt-in (?demo=1). Deciding it here, before
// React mounts, means a live session can never transition into scripted
// scaffolding mid-run — there is no code path from live to demo after boot.
if (new URLSearchParams(location.search).get('demo') === '1') {
  enterDemoMode()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
