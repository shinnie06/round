import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import { parseRoundState } from './schema'
import type { RoundState } from './types'

/**
 * Share links carry the ENTIRE round in the URL hash: `#r=<lz-string>`.
 * No backend, no accounts — if you have the link, you have the bill.
 * The hash never reaches a server (fragments aren't sent in requests),
 * so the privacy story survives even when shared over hosted deploys.
 *
 * Envelope is version-tagged so v2 can migrate old links instead of
 * silently misreading them.
 */
const KEY = 'r'

export function encodeShareHash(state: RoundState): string {
  const packed = compressToEncodedURIComponent(JSON.stringify({ v: 1, s: state }))
  return `${KEY}=${packed}`
}

/** Accepts `r=…`, `#r=…`, or a full hash string. Null on ANY failure — never throws. */
export function decodeShareHash(hash: string): RoundState | null {
  try {
    const raw = hash.startsWith('#') ? hash.slice(1) : hash
    const params = new URLSearchParams(raw)
    const packed = params.get(KEY)
    if (!packed) return null
    const json = decompressFromEncodedURIComponent(packed)
    if (!json) return null
    const envelope: unknown = JSON.parse(json)
    if (typeof envelope !== 'object' || envelope === null) return null
    if ((envelope as { v?: unknown }).v !== 1) return null
    return parseRoundState((envelope as { s?: unknown }).s)
  } catch {
    return null
  }
}
