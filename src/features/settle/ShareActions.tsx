'use client'
import { useState } from 'react'
import { Link2, Share2, Check } from 'lucide-react'
import { encodeShareHash } from '@/state/urlhash'
import { useStore } from '@/state/store'
import { Button } from '@/components/Button'

/**
 * The whole round, in a URL. The hash never reaches any server —
 * fragments aren't sent in HTTP requests — so sharing stays as private
 * as the OCR.
 */
function shareUrl(): string {
  const hash = encodeShareHash(useStore.getState().round)
  return `${window.location.origin}${window.location.pathname}#${hash}`
}

export function ShareActions() {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard denied — the native share path still works */
    }
  }

  const nativeShare = async () => {
    try {
      await navigator.share({ title: 'Round — our bill', url: shareUrl() })
    } catch {
      /* user dismissed the share sheet */
    }
  }

  const canNativeShare = typeof navigator !== 'undefined' && 'share' in navigator

  return (
    <div className="flex gap-2">
      <Button variant="ghost" className="flex-1" onClick={() => void copy()}>
        {copied ? <Check size={16} className="text-good" aria-hidden /> : <Link2 size={16} aria-hidden />}
        {copied ? 'Copied' : 'Copy link'}
      </Button>
      {canNativeShare && (
        <Button variant="ghost" className="flex-1" onClick={() => void nativeShare()}>
          <Share2 size={16} aria-hidden /> Share
        </Button>
      )}
    </div>
  )
}
