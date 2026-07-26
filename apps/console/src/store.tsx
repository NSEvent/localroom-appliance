// One store: useReducer + context. `state.updated` REPLACES the whole
// SessionState (D11) — there is no client-side merge logic to get wrong.
// The WS client lives here too: reconnect with backoff, then GET .../state.

import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import * as api from './api'
import * as clock from './clock.ts'
import type { Health, QaEntry, SessionState, Utterance, WsEvent } from './types'

export type WsStatus = 'connecting' | 'open' | 'reconnecting'

export interface AppState {
  sessionId: string
  session: SessionState | null
  loading: boolean
  loadError: string | null
  wsStatus: WsStatus
  /** utterances appended (via utterance.created) since the last state.updated —
   * drives the "operator analyzing N utterances…" shimmer (D15). */
  pendingUtterances: number
  /** ms of last full-state receipt (WS or GET) */
  lastStateAt: number | null
  /** ms of last transcript append */
  lastUtteranceAt: number | null
  health: Health | null
  healthError: boolean
  /** partial text of the currently streaming Q&A answer, if any */
  qaStream: { qaId: string | null; text: string } | null
}

export type Action =
  | { type: 'state'; state: SessionState }
  | { type: 'load-error'; error: string }
  | { type: 'utterance'; utterance: Utterance }
  | { type: 'qa-answered'; qa: QaEntry }
  | { type: 'qa-token'; qaId: string | null; token: string }
  | { type: 'session-ended' }
  | { type: 'ws-status'; status: WsStatus }
  | { type: 'health'; health: Health | null }

function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'state':
      return {
        ...s,
        session: a.state,
        loading: false,
        loadError: null,
        pendingUtterances: 0,
        lastStateAt: clock.nowMs(),
      }
    case 'load-error':
      return { ...s, loading: false, loadError: a.error }
    case 'utterance': {
      if (!s.session) return s
      if (s.session.utterances.some((u) => u.id === a.utterance.id)) return s
      return {
        ...s,
        session: { ...s.session, utterances: [...s.session.utterances, a.utterance] },
        pendingUtterances: s.pendingUtterances + 1,
        lastUtteranceAt: clock.nowMs(),
      }
    }
    case 'qa-answered': {
      if (!s.session) return s
      const qa = s.session.qa.some((q) => q.id === a.qa.id)
        ? s.session.qa.map((q) => (q.id === a.qa.id ? a.qa : q))
        : [...s.session.qa, a.qa]
      return { ...s, session: { ...s.session, qa }, qaStream: null }
    }
    case 'qa-token': {
      const prev = s.qaStream
      const text =
        prev && (prev.qaId === a.qaId || a.qaId === null) ? prev.text + a.token : a.token
      return { ...s, qaStream: { qaId: a.qaId ?? prev?.qaId ?? null, text } }
    }
    case 'session-ended':
      return s.session
        ? {
            ...s,
            session: {
              ...s.session,
              session: { ...s.session.session, status: 'ended' },
            },
          }
        : s
    case 'ws-status':
      return { ...s, wsStatus: a.status }
    case 'health':
      return { ...s, health: a.health, healthError: a.health === null }
  }
}

export interface Store extends AppState {
  dispatch: (a: Action) => void
  refresh: () => void
}

const StoreContext = createContext<Store | null>(null)

export function useStore(): Store {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore outside SessionProvider')
  return ctx
}

export function SessionProvider({
  sessionId,
  children,
}: {
  sessionId: string
  children: ReactNode
}) {
  const [state, dispatch] = useReducer(reducer, sessionId, (id) => ({
    sessionId: id,
    session: null,
    loading: true,
    loadError: null,
    wsStatus: 'connecting' as WsStatus,
    pendingUtterances: 0,
    lastStateAt: null,
    lastUtteranceAt: null,
    health: null,
    healthError: false,
    qaStream: null,
  }))

  const refresh = () => {
    api
      .getState(sessionId)
      .then((st) => dispatch({ type: 'state', state: st }))
      .catch((e: unknown) =>
        dispatch({ type: 'load-error', error: e instanceof Error ? e.message : String(e) }),
      )
  }
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  // ---- WS client with backoff; GET .../state on (re)connect ----
  useEffect(() => {
    let ws: WebSocket | null = null
    let closed = false
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const connect = () => {
      if (closed) return
      dispatch({ type: 'ws-status', status: attempts === 0 ? 'connecting' : 'reconnecting' })
      try {
        ws = new WebSocket(api.wsUrl(sessionId))
      } catch {
        scheduleRetry()
        return
      }
      ws.onopen = () => {
        attempts = 0
        dispatch({ type: 'ws-status', status: 'open' })
        // Recovery path (D11): full state on every (re)connect.
        refreshRef.current()
      }
      ws.onmessage = (msg) => {
        let ev: WsEvent
        try {
          ev = JSON.parse(String(msg.data)) as WsEvent
        } catch {
          return
        }
        switch (ev.type) {
          case 'utterance.created':
            dispatch({ type: 'utterance', utterance: ev.utterance })
            break
          case 'state.updated':
            dispatch({ type: 'state', state: ev.state })
            break
          case 'qa.answered':
            dispatch({ type: 'qa-answered', qa: ev.qa })
            break
          case 'qa.token':
            dispatch({
              type: 'qa-token',
              qaId: ev.qa_id ?? ev.id ?? null,
              token: ev.token ?? ev.text ?? '',
            })
            break
          case 'session.ended':
            dispatch({ type: 'session-ended' })
            break
        }
      }
      ws.onclose = () => {
        ws = null
        if (!closed) scheduleRetry()
      }
      ws.onerror = () => {
        ws?.close()
      }
    }

    const scheduleRetry = () => {
      dispatch({ type: 'ws-status', status: 'reconnecting' })
      attempts += 1
      const delay = Math.min(8000, 500 * 2 ** Math.min(attempts, 4))
      timer = setTimeout(connect, delay)
    }

    // Initial state fetch happens on ws open; also fetch immediately so the
    // panels populate even if the socket is slow to establish.
    refreshRef.current()
    connect()

    return () => {
      closed = true
      if (timer) clearTimeout(timer)
      ws?.close()
    }
  }, [sessionId])

  // ---- anchor the one virtual clock to this session ----
  // Live mode derives meeting time from started_at + wall clock. Re-asserting
  // an unchanged anchor is a no-op, so this is safe on every state update.
  const startedAt = state.session?.session.started_at ?? null
  useEffect(() => {
    clock.configureLive(startedAt)
  }, [startedAt])

  // ---- runtime status: poll the aggregated health endpoint ----
  // Rides clock.everyWallMs, not setInterval: the health probe is a network
  // poll, not a displayed counter, so it must keep running through a demo
  // pause — but the timer still belongs to the clock module so the ban on
  // component-level timers stays absolute.
  useEffect(() => {
    let stop = false
    const tick = () => {
      api
        .getHealth()
        .then((h) => {
          if (!stop) dispatch({ type: 'health', health: h })
        })
        .catch(() => {
          if (!stop) dispatch({ type: 'health', health: null })
        })
    }
    tick()
    const cancel = clock.everyWallMs(5000, tick)
    return () => {
      stop = true
      cancel()
    }
  }, [sessionId])

  const store: Store = { ...state, dispatch, refresh }
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}
