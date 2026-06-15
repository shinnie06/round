/**
 * preprocessReceipt — shrink the photo before it crosses the wire.
 * 1024px on the long edge at JPEG 0.85 is plenty for receipt text and
 * keeps vision-model prompt processing fast on a laptop. EXIF rotation
 * is honored by createImageBitmap so portrait phone shots stay upright.
 */
const MAX_EDGE = 1024
const JPEG_QUALITY = 0.85

export async function preprocessReceipt(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not prepare the image (canvas unavailable).')
    ctx.drawImage(bitmap, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  } finally {
    bitmap.close()
  }
}
