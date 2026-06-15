import type { Metadata, Viewport } from 'next'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/instrument-sans'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://round.shinnielab.com'),
  title: 'Round — whose round is it?',
  description:
    'Split Singapore restaurant receipts with local, private OCR. Discount → service → GST, to the cent.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/favicon.svg',
    apple: '/apple-touch-icon-v3.png',
  },
  openGraph: {
    title: 'Round — whose round is it?',
    description:
      'Split Singapore restaurant receipts with local, private OCR. Discount → service → GST, to the cent.',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    images: ['/og.png'],
  },
}

export const viewport: Viewport = {
  themeColor: '#12100B',
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="bg-ink">
      <body>{children}</body>
    </html>
  )
}
