import { rawReceiptZod, RECEIPT_JSON_SCHEMA } from './schema'
import { RECEIPT_SYSTEM_PROMPT, RECEIPT_USER_PROMPT } from './prompt'
import type { RawReceipt } from './types'

/**
 * LMStudio client. The phone-hits-laptop topology means the LMStudio
 * host is *whatever host served the PWA* (your laptop), not localhost —
 * so the default base derives from window.location.hostname and is
 * overridable from the connection pill.
 */
const OVERRIDE_KEY = 'round.lmstudio.url'
const PORT = 1234

export function lmstudioBase(): string {
  if (typeof window !== 'undefined') {
    const override = window.localStorage.getItem(OVERRIDE_KEY)
    if (override) return override.replace(/\/+$/, '')
    // On HTTPS, plain http://host:1234 is blocked as mixed content — use the
    // same origin instead and let the reverse proxy forward /v1/* to LMStudio.
    if (window.location.protocol === 'https:') return window.location.origin
    return `http://${window.location.hostname}:${PORT}`
  }
  return `http://localhost:${PORT}`
}

export function setLmstudioOverride(url: string | null): void {
  if (url) window.localStorage.setItem(OVERRIDE_KEY, url)
  else window.localStorage.removeItem(OVERRIDE_KEY)
}

/** Ordered by preference: explicit VL models first, gemma (multimodal) as fallback. */
const VISION_MODEL_RES = [/vl|vision/i, /gemma/i]

export interface ProbeResult {
  status: 'green' | 'amber' | 'red'
  model?: string
}

/** Connection pill: red = unreachable, amber = no vision model, green = ready. */
export async function probeLmstudio(): Promise<ProbeResult> {
  try {
    const res = await fetch(`${lmstudioBase()}/v1/models`, {
      signal: AbortSignal.timeout(1500),
    })
    if (!res.ok) return { status: 'red' }
    const body = (await res.json()) as { data?: { id?: string }[] }
    const ids = (body.data ?? []).map((m) => m.id ?? '')
    for (const re of VISION_MODEL_RES) {
      const vision = ids.find((id) => re.test(id))
      if (vision) return { status: 'green', model: vision }
    }
    return { status: 'amber' }
  } catch {
    return { status: 'red' }
  }
}

/** One receipt photo in, one validated RawReceipt out. Throws user-readable Errors.
 *  opts.model overrides the probe's auto-pick (used by the eval harness to
 *  benchmark specific models); the app itself always lets the probe choose. */
export async function ocrReceipt(
  dataUrl: string,
  opts: { signal?: AbortSignal; model?: string } = {},
): Promise<RawReceipt> {
  const probe = await probeLmstudio()
  if (probe.status === 'red') {
    throw new Error(
      "Can't reach LMStudio. Start its server (port 1234) with CORS enabled — see the connection pill.",
    )
  }
  const model = opts.model ?? probe.model
  if (!model) {
    throw new Error('LMStudio is running but no vision model is loaded. Load qwen/qwen3-vl-8b.')
  }

  let res: Response
  try {
    res = await fetch(`${lmstudioBase()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: opts.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_schema', json_schema: RECEIPT_JSON_SCHEMA },
        messages: [
          { role: 'system', content: RECEIPT_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: dataUrl } },
              { type: 'text', text: RECEIPT_USER_PROMPT },
            ],
          },
        ],
      }),
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new Error('Lost the connection to LMStudio mid-read. Is the server still running?')
  }
  if (!res.ok) {
    throw new Error(`LMStudio answered ${res.status}. Check the server logs in LMStudio.`)
  }

  const completion = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const content = completion.choices?.[0]?.message?.content
  if (!content) throw new Error('The model returned an empty response. Try a clearer photo.')

  try {
    return rawReceiptZod.parse(JSON.parse(content))
  } catch {
    throw new Error('The model returned something unreadable. Try again, or retake the photo.')
  }
}
