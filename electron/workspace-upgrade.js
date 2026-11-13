/**
 * Bringing an existing workspace up to date with the app that opened it.
 *
 * A workspace is seeded once, when it is empty. Before 0.2.0 that was the end of
 * it: the reference docs, the SDK type declarations and the agent guidance stayed
 * at whatever version first created the folder, so a designer's coding agent kept
 * reading an API that the app no longer had. This module refreshes those files.
 *
 * The rule is that the app only ever replaces what it wrote and nobody touched
 * since. Every file the seed owns is recorded with its hash in
 * `.planchette/seed.json`. On upgrade:
 *
 *  - a file still matching what was written is replaced with the new version;
 *  - a file the designer edited is kept, and the new version is written beside it
 *    (`API.md` -> `API.new.md`) for them to merge;
 *  - a file or example the designer deleted stays deleted;
 *  - something new in this seed, which the workspace never had, is added;
 *  - examples are never overwritten, only added when new.
 *
 * Workspaces from 0.1.x have no manifest. For those, the hashes of every file as
 * shipped in each 0.1.x release (`history`) stand in for it.
 *
 * Deliberately free of Electron imports, so the build scripts and the unit tests
 * can use it directly.
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

export const MANIFEST_DIR = '.planchette'
export const MANIFEST_FILE = 'seed.json'
/** Lives in the seed only. Never copied into a workspace. */
export const HISTORY_FILE = 'history.json'

/* ------------------------------------------------------------------ *
 * Building a manifest
 * ------------------------------------------------------------------ */

export function hashBuffer(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

async function hashFile(file) {
  return hashBuffer(await fsp.readFile(file))
}

/** Forward slashes on every platform, so manifests compare across machines. */
const toPosix = (p) => p.split(path.sep).join('/')
const fromPosix = (p) => p.split('/').join(path.sep)

async function walk(dir, base = dir) {
  const out = []
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(full, base)))
    else if (e.isFile()) out.push(toPosix(path.relative(base, full)))
  }
  return out
}

/** A top-level folder holding an index.html is an interface, and belongs to the designer once copied. */
async function isInterfaceDir(root, name) {
  return fs.existsSync(path.join(root, name, 'index.html'))
}

/**
 * Describe a seed folder: the hash of every file the app owns, and the names of
 * the example interfaces. The manifest's own folder is never part of it.
 */
export async function buildManifest(seedDir, seedVersion) {
  const examples = []
  const files = {}
  for (const e of await fsp.readdir(seedDir, { withFileTypes: true })) {
    if (e.name === MANIFEST_DIR) continue
    if (e.isDirectory() && (await isInterfaceDir(seedDir, e.name))) {
      examples.push(e.name)
      continue
    }
    const rels = e.isDirectory() ? (await walk(path.join(seedDir, e.name))).map((r) => `${e.name}/${r}`) : [e.name]
    for (const rel of rels) files[rel] = await hashFile(path.join(seedDir, fromPosix(rel)))
  }
  return { seedVersion, files: sortKeys(files), examples: examples.sort() }
}

function sortKeys(o) {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/* ------------------------------------------------------------------ *
 * Versions
 * ------------------------------------------------------------------ */

/** Compare dotted numeric versions. Anything after a dash is ignored. */
export function compareVersions(a, b) {
  const pa = String(a).split('-')[0].split('.').map(Number)
  const pb = String(b).split('-')[0].split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return Math.sign(d)
  }
  return 0
}

/* ------------------------------------------------------------------ *
 * Upgrading
 * ------------------------------------------------------------------ */

async function readJson(file) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch {
    return null
  }
}

/** `API.md` -> `API.new.md`, `types/index.d.ts` -> `types/index.new.d.ts`. */
export function sidecarName(rel) {
  const dir = path.posix.dirname(rel)
  const base = path.posix.basename(rel)
  const m = /^(.+?)((?:\.d)?\.[^.]+)?$/.exec(base)
  // A dotfile such as `.editorconfig` has no stem to put `.new` in front of.
  const name = m && m[1] && !m[1].startsWith('.') ? `${m[1]}.new${m[2] ?? ''}` : `${base}.new`
  return dir === '.' ? name : `${dir}/${name}`
}

/** Write via a temp file and a rename, so a crash never leaves half a file. */
async function writeAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fsp.writeFile(tmp, data)
  await fsp.rename(tmp, file)
}

/**
 * What the workspace was seeded with: its own manifest, or for a 0.1.x workspace
 * the union of everything those releases shipped. Returns null for a folder the
 * app never seeded, which it then leaves alone.
 */
async function priorState(workspace, newManifest, history) {
  const manifest = await readJson(path.join(workspace, MANIFEST_DIR, MANIFEST_FILE))
  if (manifest && typeof manifest.files === 'object') {
    return {
      legacy: false,
      seedVersion: String(manifest.seedVersion ?? '0.0.0'),
      known: (rel) => (manifest.files[rel] ? [manifest.files[rel]] : []),
      hadFile: (rel) => rel in manifest.files,
      hadExample: (name) => Array.isArray(manifest.examples) && manifest.examples.includes(name),
    }
  }

  const versions = Object.values(history ?? {})
  const known = (rel) => versions.map((v) => v.files?.[rel]).filter(Boolean)

  // Only a folder holding at least one seeded file was ever seeded. A folder of
  // the designer's own, added as a workspace, never received the reference files,
  // and an upgrade is no reason to start writing into it now.
  const owned = new Set([...versions.flatMap((v) => Object.keys(v.files ?? {})), ...Object.keys(newManifest.files)])
  const anyPresent = [...owned].some((rel) => fs.existsSync(path.join(workspace, fromPosix(rel))))
  if (!anyPresent) return null

  return {
    legacy: true,
    seedVersion: '0.1.x',
    known,
    hadFile: (rel) => known(rel).length > 0,
    hadExample: (name) => versions.some((v) => v.examples?.includes(name)),
  }
}

/**
 * Bring `workspace` up to the seed in `seedDir`.
 *
 * Returns a report: `{ status, from, to, added, updated, kept, removed, examplesAdded }`.
 * `status` is `upgraded`, `current` (nothing to do), `newer` (the workspace came
 * from a later app, so it is left alone), or `unseeded` (not a folder the app
 * seeded). `kept` lists `{ path, newCopy }` for each file the designer edited.
 */
export async function upgradeWorkspace(workspace, seedDir, appVersion) {
  const report = {
    status: 'current',
    from: null,
    to: appVersion,
    added: [],
    updated: [],
    kept: [],
    removed: [],
    examplesAdded: [],
  }

  const next = await readJson(path.join(seedDir, MANIFEST_DIR, MANIFEST_FILE))
  if (!next?.files) return { ...report, status: 'no-seed' }
  const history = await readJson(path.join(seedDir, MANIFEST_DIR, HISTORY_FILE))

  const prior = await priorState(workspace, next, history)
  if (!prior) return { ...report, status: 'unseeded' }
  report.from = prior.seedVersion

  if (!prior.legacy) {
    const cmp = compareVersions(prior.seedVersion, next.seedVersion)
    if (cmp > 0) return { ...report, status: 'newer' }
  }

  for (const [rel, newHash] of Object.entries(next.files)) {
    const dest = path.join(workspace, fromPosix(rel))
    const src = path.join(seedDir, fromPosix(rel))

    if (!fs.existsSync(dest)) {
      // Deleted by the designer: respect it. Never had it: add it.
      if (prior.hadFile(rel)) continue
      await writeAtomic(dest, await fsp.readFile(src))
      report.added.push(rel)
      continue
    }

    const current = await hashFile(dest)
    if (current === newHash) continue
    const known = prior.known(rel)
    if (known.includes(current)) {
      await writeAtomic(dest, await fsp.readFile(src))
      report.updated.push(rel)
    } else if (known.length && known.every((h) => h === newHash)) {
      // Edited, but the app's version has not changed since they last got it, so
      // there is nothing new to offer. Without this, every launch would write a
      // fresh `.new` copy beside every file a designer had ever touched.
      continue
    } else {
      const side = sidecarName(rel)
      await writeAtomic(path.join(workspace, fromPosix(side)), await fsp.readFile(src))
      report.kept.push({ path: rel, newCopy: side })
    }
  }

  // Files an earlier seed owned that this one dropped. Removed only if untouched.
  if (!prior.legacy) {
    const manifest = await readJson(path.join(workspace, MANIFEST_DIR, MANIFEST_FILE))
    for (const [rel, oldHash] of Object.entries(manifest.files)) {
      if (rel in next.files) continue
      const dest = path.join(workspace, fromPosix(rel))
      if (!fs.existsSync(dest)) continue
      if ((await hashFile(dest)) === oldHash) {
        await fsp.rm(dest)
        report.removed.push(rel)
      }
    }
  }

  for (const name of next.examples ?? []) {
    const dest = path.join(workspace, name)
    if (fs.existsSync(dest) || prior.hadExample(name)) continue
    await fsp.cp(path.join(seedDir, name), dest, { recursive: true, force: false, errorOnExist: false })
    report.examplesAdded.push(name)
  }

  // Last, so an interrupted run simply runs again next time.
  await writeManifest(workspace, next)

  const changed =
    report.added.length +
    report.updated.length +
    report.kept.length +
    report.removed.length +
    report.examplesAdded.length
  const versionMoved = prior.legacy || compareVersions(prior.seedVersion, next.seedVersion) !== 0
  report.status = changed || versionMoved ? 'upgraded' : 'current'
  return report
}

/** Record what a workspace now holds. History stays in the seed. */
export async function writeManifest(workspace, manifest) {
  const { seedVersion, files, examples } = manifest
  await writeAtomic(
    path.join(workspace, MANIFEST_DIR, MANIFEST_FILE),
    JSON.stringify({ seedVersion, files, examples }, null, 2) + '\n',
  )
}
