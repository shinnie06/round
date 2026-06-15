'use client'
import { useCallback, useEffect, useState } from 'react'
import { lmstudioBase, probeLmstudio, setLmstudioOverride, type ProbeResult } from '@/features/ocr/lmstudio'
import { Sheet } from './Sheet'
import { Field } from './Field'
import { Button } from './Button'
import { cn } from '@/lib/cn'

const DOT: Record<ProbeResult['status'], string> = {
  green: 'bg-good',
  amber: 'bg-warn animate-pulse-soft',
  red: 'bg-bad',
}

const LABEL: Record<ProbeResult['status'], string> = {
  green: 'LMStudio ready',
  amber: 'No vision model',
  red: 'LMStudio offline',
}

/** Splash-corner status for the local OCR backend; tap to override the URL. */
export function ConnectionPill() {
  const [probe, setProbe] = useState<ProbeResult>({ status: 'red' })
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')

  const refresh = useCallback(() => {
    void probeLmstudio().then(setProbe)
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 5000)
    return () => clearInterval(t)
  }, [refresh])

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setUrl(lmstudioBase())
          setOpen(true)
        }}
        className={cn(
          'inline-flex items-center gap-2 rounded-full border border-line bg-ink-2/80',
          'px-3 py-1.5 text-small text-cream-dim hover:text-cream backdrop-blur',
        )}
        aria-label={`LMStudio connection: ${LABEL[probe.status]}. Configure.`}
      >
        <span className={cn('h-2 w-2 rounded-full', DOT[probe.status])} aria-hidden />
        <span className="max-w-40 truncate">
          {probe.status === 'green' ? (probe.model ?? LABEL.green) : LABEL[probe.status]}
        </span>
      </button>

      <Sheet open={open} onOpenChange={setOpen} title="LMStudio connection">
        <div className="flex flex-col gap-4">
          <p className="text-small text-cream-dim">
            Round talks to the LMStudio server on your laptop. Default is{' '}
            <span className="money">
              {typeof window === 'undefined'
                ? 'localhost:1234'
                : window.location.protocol === 'https:'
                  ? window.location.host
                  : `${window.location.hostname}:1234`}
            </span>
            ; override it if your server lives elsewhere.
          </p>
          <Field
            label="LMStudio URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <div className="flex gap-2">
            <Button
              onClick={() => {
                setLmstudioOverride(url.trim() || null)
                refresh()
                setOpen(false)
              }}
            >
              Save
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setLmstudioOverride(null)
                setUrl(lmstudioBase())
                refresh()
              }}
            >
              Reset to default
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  )
}
