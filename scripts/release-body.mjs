/**
 * Assemble the body of a GitHub release.
 *
 * Two things belong on that page and `body_path` only accepts one file: what
 * changed in this version, which lives in CHANGELOG.md, and how to get past
 * Gatekeeper and SmartScreen, which lives in docs/release-notes.md and reads the
 * same every time. Someone who downloads a build reads the release page and
 * never sees the repository, so neither half can be dropped.
 *
 * Both platform jobs publish to the same release and each replaces the body
 * rather than appending, so this has to be deterministic. It reads only
 * committed files, so it is.
 *
 *   node scripts/release-body.mjs [outfile]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const out = process.argv[2] ?? 'release/RELEASE_BODY.md'

const { version } = JSON.parse(await readFile('package.json', 'utf8'))
const changelog = await readFile('CHANGELOG.md', 'utf8')

/**
 * The section for exactly this version, heading to next heading.
 *
 * Unreleased is deliberately not accepted as a fallback. Shipping a version
 * whose changes are still filed under Unreleased means the changelog was not
 * retitled, and a release page that quietly says nothing is worse than a build
 * that stops and tells you.
 */
const heading = new RegExp(String.raw`^## \[${version.replace(/\./g, String.raw`\.`)}\]`, 'm')
const start = changelog.search(heading)

if (start === -1) {
  console.error(
    `CHANGELOG.md has no section for ${version}.\n\n` +
      `Retitle the Unreleased section before tagging:\n` +
      `  ## [${version}] - ${'YYYY-MM-DD'}\n\n` +
      `and add a fresh, empty Unreleased above it.`,
  )
  process.exit(1)
}

// Past the heading line, then up to the next one.
const afterHeading = changelog.slice(start).replace(/^.*\n/, '')
const nextHeading = afterHeading.search(/^## /m)
const section = (nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading))
  // Link definitions live at the foot of the file and belong to the whole
  // changelog, not to whichever version happens to be last.
  .replace(/^\[[^\]]+\]:\s*\S+\s*$/gm, '')
  .trim()

if (!section) {
  console.error(`CHANGELOG.md has a heading for ${version} but nothing under it.`)
  process.exit(1)
}

const notes = (await readFile('docs/release-notes.md', 'utf8')).trim()

// Changes first: the release page for a specific version is opened by someone
// asking what is in that version. The install guidance is durable and sits
// below, still well above the fold for a first-time downloader.
const body = `## What changed\n\n${section}\n\n---\n\n${notes}\n`

await mkdir(path.dirname(out), { recursive: true })
await writeFile(out, body)
console.log(`${out}  (${version}, ${body.split('\n').length} lines)`)
