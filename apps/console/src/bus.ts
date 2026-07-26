// Tiny pub/sub for cross-panel "jump to" interactions (evidence → transcript,
// alert → record card). Keeps the store free of imperative scroll concerns.

type Handler = (id: string) => void

const channels = new Map<string, Set<Handler>>()

export type Channel = 'jump-utterance' | 'jump-entity'

export function on(channel: Channel, handler: Handler): () => void {
  let set = channels.get(channel)
  if (!set) {
    set = new Set()
    channels.set(channel, set)
  }
  set.add(handler)
  return () => {
    set.delete(handler)
  }
}

export function emit(channel: Channel, id: string): void {
  channels.get(channel)?.forEach((h) => h(id))
}
