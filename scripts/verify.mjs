/**
 * Visual verification harness (used in CI / by Claude during the build).
 * Serves the static export, drives the real user flow in headless Chromium,
 * captures screenshots at phone + desktop sizes, and fails on console errors.
 *
 * Usage: node scripts/verify.mjs <outDir> <shotsDir> [chromiumPath]
 */
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { extname, join } from 'node:path'

const [outDir = 'out', shotsDir = '/tmp/shots', execPath] = process.argv.slice(2)

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain',
}

const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (path.endsWith('/')) path += 'index.html'
  let file = join(outDir, path)
  try {
    let body
    try { body = await readFile(file) }
    catch { body = await readFile(join(outDir, path + '.html')) }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    const body = await readFile(join(outDir, 'index.html'))
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(body)
  }
})
await new Promise((r) => server.listen(4173, r))

const { chromium } = await import('playwright-core')
const browser = await chromium.launch({
  executablePath: execPath || undefined,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})

await mkdir(shotsDir, { recursive: true })
const errors = []
const BASE = 'http://localhost:4173'

async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  page.setDefaultTimeout(8000)
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console] ${m.text().slice(0, 300)}`)
  })
  page.on('pageerror', (e) => errors.push(`[pageerror] ${String(e).slice(0, 300)}`))
  return page
}

process.on('uncaughtException', async (e) => {
  console.log('FAILED:', String(e).slice(0, 400))
  console.log(errors.length ? `ERRORS SO FAR:\n${errors.join('\n')}` : 'no console errors so far')
  process.exit(3)
})
process.on('unhandledRejection', async (e) => {
  console.log('FAILED:', String(e).slice(0, 400))
  console.log(errors.length ? `ERRORS SO FAR:\n${errors.join('\n')}` : 'no console errors so far')
  process.exit(3)
})

const shot = (page, name) =>
  page.screenshot({ path: join(shotsDir, `${name}.png`), fullPage: false })

// ——— 1. splash, mobile + desktop ———
const mobile = await newPage({ width: 390, height: 844 })
await mobile.goto(BASE, { waitUntil: 'networkidle' })
await mobile.waitForTimeout(1800) // GSAP intro settles
await shot(mobile, '01-splash-mobile')

const desktop = await newPage({ width: 1440, height: 900 })
await desktop.goto(BASE, { waitUntil: 'networkidle' })
await desktop.waitForTimeout(1800)
await shot(desktop, '02-splash-desktop')
await desktop.close()

// ——— 2. manual flow on mobile ———
await mobile.getByRole('button', { name: /enter manually/i }).click()
await mobile.waitForTimeout(800)
await shot(mobile, '02b-workspace-empty-mobile')

// add three diners (the input stays open after Enter, so click "Add" once)
await mobile.getByRole('button', { name: /add person/i }).click()
for (const name of ['Shin', 'Mei Lin', 'Raj']) {
  await mobile.getByLabel(/new person's name/i).fill(name)
  await mobile.keyboard.press('Enter')
  await mobile.waitForTimeout(300)
}
await mobile.getByLabel(/venue name/i).click() // blur the add-person input

// venue
await mobile.getByLabel(/venue name/i).fill('Jumbo Seafood')

// add items
const items = [
  { name: 'Chilli Crab', price: '88.00' },
  { name: 'Cereal Prawns', price: '32.00' },
  { name: 'Tiger Beer', price: '27.00', qty: '3' },
]
for (const it of items) {
  await mobile.getByRole('button', { name: /add item/i }).click()
  await mobile.waitForTimeout(450)
  await mobile.locator('#item-name').fill(it.name)
  if (it.qty) await mobile.locator('#item-qty').fill(it.qty)
  await mobile.locator('#item-price').fill(it.price)
  await mobile.getByRole('button', { name: /^done$/i }).click()
  await mobile.waitForTimeout(450)
}

// discount
await mobile.getByLabel(/discount in dollars/i).fill('5.00')
await mobile.waitForTimeout(400)
await shot(mobile, '03-workspace-mobile')

// open assign sheet for beer, restrict to two diners
await mobile.getByRole('button', { name: /tiger beer/i }).click()
await mobile.waitForTimeout(500)
await mobile.getByRole('button', { name: /mei lin/i }).click()
await mobile.waitForTimeout(300)
await shot(mobile, '04-assign-sheet-mobile')
await mobile.getByRole('button', { name: /^done$/i }).click()
await mobile.waitForTimeout(500)

// ——— 3. settle ———
await mobile.getByRole('button', { name: /square up/i }).click()
await mobile.waitForTimeout(900)
await shot(mobile, '05-settle-mobile')

// expand first card
await mobile.getByRole('button', { name: /shin/i }).first().click()
await mobile.waitForTimeout(600)
await shot(mobile, '06-settle-expanded-mobile')

// ——— 4. share link read-only view (desktop) ———
// Read the real share URL off the clipboard after clicking "Copy link".
const ctx2 = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  permissions: ['clipboard-read', 'clipboard-write'],
  deviceScaleFactor: 2,
})
await mobile.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
await mobile.getByRole('button', { name: /copy link/i }).click()
await mobile.waitForTimeout(400)
const url = await mobile.evaluate(() => navigator.clipboard.readText())
const ro = await ctx2.newPage()
ro.on('console', (m) => { if (m.type() === 'error') errors.push(`[console-ro] ${m.text().slice(0, 300)}`) })
await ro.goto(url, { waitUntil: 'networkidle' })
await ro.waitForTimeout(900)
await shot(ro, '07-readonly-desktop')

// ——— 5. workspace desktop (quick manual flow) ———
const wd = await ctx2.newPage()
wd.setDefaultTimeout(8000)
wd.on('pageerror', (e) => errors.push(`[pageerror-wd] ${String(e).slice(0, 300)}`))
await wd.goto(BASE, { waitUntil: 'networkidle' })
await wd.waitForTimeout(1500)
await wd.getByRole('button', { name: /enter manually/i }).click()
await wd.waitForTimeout(700)
await wd.getByRole('button', { name: /add person/i }).click()
for (const name of ['Shin', 'Mei Lin']) {
  await wd.getByLabel(/new person's name/i).fill(name)
  await wd.keyboard.press('Enter')
  await wd.waitForTimeout(250)
}
await wd.getByLabel(/venue name/i).fill('Lau Pa Sat')
for (const it of [{ name: 'Satay (10 stick)', price: '12.00' }, { name: 'Kopi Peng', price: '3.60' }]) {
  await wd.getByRole('button', { name: /add item/i }).click()
  await wd.waitForTimeout(450)
  await wd.locator('#item-name').fill(it.name)
  await wd.locator('#item-price').fill(it.price)
  await wd.getByRole('button', { name: /^done$/i }).click()
  await wd.waitForTimeout(450)
}
await shot(wd, '08-workspace-desktop')

// LMStudio probes are EXPECTED to fail in the harness (no LMStudio here);
// the connection pill turning red is correct behaviour, not an error.
const real = errors.filter((e) => !/ERR_CONNECTION_REFUSED/.test(e))
console.log('SHARE_URL_LEN', url.length)
console.log(real.length ? `ERRORS:\n${real.join('\n')}` : 'NO CONSOLE ERRORS')
await browser.close()
server.close()
process.exit(real.length ? 2 : 0)
