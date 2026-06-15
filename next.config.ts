import type { NextConfig } from 'next'

/**
 * Round is local-first: no server, ever. `output: 'export'` produces a
 * fully static bundle (the `out/` folder) that any static host — or
 * `npm start` on your laptop — can serve. All data lives in the URL hash
 * and IndexedDB; OCR talks to YOUR LMStudio over LAN.
 */
const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  devIndicators: false,
  // A stray lockfile in $HOME makes Next infer the wrong workspace root.
  turbopack: { root: import.meta.dirname },
}

export default nextConfig
