#!/usr/bin/env node
/**
 * Builds the public site into site/_build, ready to upload as-is.
 *
 *   node site/build.mjs            # then serve site/_build, e.g. npx serve site/_build
 *
 * The page always offers the newest published release, pre-releases included,
 * that has a web build attached. The live demo is that release's planchette-web
 * zip rather than this checkout, because docs/EMBED.md is right that a site must
 * match what people download. deploy-site.yml rebuilds whenever a release is
 * published, so nothing needs editing here when a version ships.
 *
 * PLANCHETTE_VERSION=0.1.1 pins a version instead. GITHUB_TOKEN, if set, avoids
 * the API's anonymous rate limit.
 *
 * Needs `unzip`, which macOS and the Ubuntu runners both have.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const out = path.join(here, '_build')
const cache = path.join(here, '.cache')
const REPO = 'hyperquake/planchette'

/** Newest published release with a web build, or the pinned one. */
async function pickRelease() {
  const headers = { accept: 'application/vnd.github+json' }
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, { headers })
  if (!res.ok) throw new Error(`GitHub releases: ${res.status}`)
  const releases = (await res.json()).filter((r) => !r.draft)
  const pinned = process.env.PLANCHETTE_VERSION
  const pick = releases.find((r) => {
    const v = r.tag_name.replace(/^v/, '')
    return (!pinned || v === pinned) && r.assets.some((a) => a.name === `planchette-web-${v}.zip`)
  })
  if (!pick) throw new Error(pinned ? `no release v${pinned} with a web build` : 'no published release has a web build')
  return { version: pick.tag_name.replace(/^v/, ''), prerelease: pick.prerelease }
}
const { version, prerelease } = await pickRelease()

await fs.rm(out, { recursive: true, force: true })
await fs.mkdir(path.join(out, 'brand'), { recursive: true })
await fs.mkdir(path.join(out, 'media'), { recursive: true })

const html = await fs.readFile(path.join(here, 'index.html'), 'utf8')
await fs.writeFile(
  path.join(out, 'index.html'),
  html.replaceAll('{{VERSION}}', version).replaceAll('{{CHANNEL}}', prerelease ? ' (beta)' : ''),
)
await fs.copyFile(path.join(here, 'style.css'), path.join(out, 'style.css'))

const MEDIA = [
  'loop.mp4',
  'loop.webm',
  'loop-poster.jpg',
  'reel.mp4',
  'arcane-table.jpg',
  'radial-atlas.jpg',
  'dial-demo.jpg',
  'riftfall.jpg',
  'air-hockey.jpg',
  'app-inspector.jpg',
  'hyperquake-logotype-black.png',
]
for (const f of MEDIA) await fs.copyFile(path.join(here, 'media', f), path.join(out, 'media', f))
await fs.copyFile(
  path.join(root, 'brand', 'lockup-horizontal-black.svg'),
  path.join(out, 'brand', 'lockup-horizontal-black.svg'),
)
for (const f of ['favicon.svg', 'favicon.ico']) await fs.copyFile(path.join(root, 'public', f), path.join(out, f))

// The pinned web build, downloaded once and cached.
const zipName = `planchette-web-${version}.zip`
const zip = path.join(cache, zipName)
try {
  await fs.access(zip)
} catch {
  const url = `https://github.com/hyperquake/planchette/releases/download/v${version}/${zipName}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}. Does release v${version} have a web build attached?`)
  await fs.mkdir(cache, { recursive: true })
  await fs.writeFile(zip, Buffer.from(await res.arrayBuffer()))
}
const unpacked = path.join(cache, `web-${version}`)
await fs.rm(unpacked, { recursive: true, force: true })
execFileSync('unzip', ['-q', zip, '-d', unpacked])
// The zip may or may not wrap its files in a folder; find the one with index.html.
const entries = await fs.readdir(unpacked)
const inner = entries.includes('index.html') ? unpacked : path.join(unpacked, entries[0])
await fs.cp(inner, path.join(out, 'embed'), { recursive: true })

console.log(`site built for v${version}${prerelease ? ' (pre-release)' : ''} in ${path.relative(root, out)}`)
