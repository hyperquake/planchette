import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  buildManifest,
  compareVersions,
  HISTORY_FILE,
  MANIFEST_DIR,
  MANIFEST_FILE,
  sidecarName,
  upgradeWorkspace,
  writeManifest,
} from '../electron/workspace-upgrade.js'

/* ---------------- helpers ---------------- */

async function tmp(name) {
  return fs.mkdtemp(path.join(os.tmpdir(), `planchette-test-${name}-`))
}

async function writeTree(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(root, ...rel.split('/'))
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, body)
  }
}

const read = (root, rel) => fs.readFile(path.join(root, ...rel.split('/')), 'utf8')
const exists = (root, rel) =>
  fs.stat(path.join(root, ...rel.split('/'))).then(
    () => true,
    () => false,
  )

/** The 0.1.x seed, as shipped. */
const OLD = {
  'API.md': 'api v1',
  'CLAUDE.md': 'guidance v1',
  'types/index.d.ts': 'types v1',
  'dial-demo/index.html': '<p>dial</p>',
  'dial-demo/main.js': 'dial v1',
}

/** The new seed: API changed, CLAUDE unchanged, one new doc, one new example. */
const NEW = {
  'API.md': 'api v2',
  'CLAUDE.md': 'guidance v1',
  'TABLE.md': 'table doc',
  'types/index.d.ts': 'types v2',
  'dial-demo/index.html': '<p>dial</p>',
  'dial-demo/main.js': 'dial v2',
  'new-example/index.html': '<p>new</p>',
}

async function makeSeed(files, version, history = {}) {
  const dir = await tmp('seed')
  await writeTree(dir, files)
  const manifest = await buildManifest(dir, version)
  await writeTree(dir, {
    [`${MANIFEST_DIR}/${MANIFEST_FILE}`]: JSON.stringify(manifest),
    [`${MANIFEST_DIR}/${HISTORY_FILE}`]: JSON.stringify(history),
  })
  return { dir, manifest }
}

async function legacyHistory() {
  const dir = await tmp('old')
  await writeTree(dir, OLD)
  const { files, examples } = await buildManifest(dir, '0.1.1')
  return { '0.1.1': { files, examples } }
}

/** A workspace as a 0.1.x app left it: the old seed, no manifest, plus the designer's own interface. */
async function legacyWorkspace(extra = {}) {
  const ws = await tmp('ws')
  await writeTree(ws, { ...OLD, 'my-thing/index.html': '<p>mine</p>', ...extra })
  return ws
}

/* ---------------- manifest ---------------- */

test('buildManifest separates owned files from example interfaces', async () => {
  const dir = await tmp('m')
  await writeTree(dir, NEW)
  const m = await buildManifest(dir, '0.2.0')
  assert.deepEqual(Object.keys(m.files), ['API.md', 'CLAUDE.md', 'TABLE.md', 'types/index.d.ts'])
  assert.deepEqual(m.examples, ['dial-demo', 'new-example'])
})

/* ---------------- legacy workspaces ---------------- */

test('legacy workspace: unedited files are refreshed, new files and examples added', async () => {
  const { dir: seed } = await makeSeed(NEW, '0.2.0', await legacyHistory())
  const ws = await legacyWorkspace()

  const r = await upgradeWorkspace(ws, seed, '0.2.0')

  assert.equal(r.status, 'upgraded')
  assert.equal(r.from, '0.1.x')
  assert.deepEqual(r.updated.sort(), ['API.md', 'types/index.d.ts'])
  assert.deepEqual(r.added, ['TABLE.md'])
  assert.deepEqual(r.examplesAdded, ['new-example'])
  assert.deepEqual(r.kept, [])
  assert.equal(await read(ws, 'API.md'), 'api v2')
  assert.equal(await read(ws, 'TABLE.md'), 'table doc')
})

test('legacy workspace: examples and interfaces are never overwritten', async () => {
  const { dir: seed } = await makeSeed(NEW, '0.2.0', await legacyHistory())
  const ws = await legacyWorkspace()
  await upgradeWorkspace(ws, seed, '0.2.0')
  assert.equal(await read(ws, 'dial-demo/main.js'), 'dial v1')
  assert.equal(await read(ws, 'my-thing/index.html'), '<p>mine</p>')
})

test('legacy workspace: an edited file is kept and the new one written beside it', async () => {
  const { dir: seed } = await makeSeed(NEW, '0.2.0', await legacyHistory())
  const ws = await legacyWorkspace({ 'API.md': 'my notes in the api doc' })

  const r = await upgradeWorkspace(ws, seed, '0.2.0')

  assert.deepEqual(r.kept, [{ path: 'API.md', newCopy: 'API.new.md' }])
  assert.equal(await read(ws, 'API.md'), 'my notes in the api doc')
  assert.equal(await read(ws, 'API.new.md'), 'api v2')
})

test('legacy workspace: a deleted file or example stays deleted', async () => {
  const { dir: seed } = await makeSeed(NEW, '0.2.0', await legacyHistory())
  const ws = await legacyWorkspace()
  await fs.rm(path.join(ws, 'CLAUDE.md'))
  await fs.rm(path.join(ws, 'dial-demo'), { recursive: true })

  await upgradeWorkspace(ws, seed, '0.2.0')

  assert.equal(await exists(ws, 'CLAUDE.md'), false)
  assert.equal(await exists(ws, 'dial-demo'), false)
})

test('a manifest is written, and the seed history never reaches the workspace', async () => {
  const { dir: seed, manifest } = await makeSeed(NEW, '0.2.0', await legacyHistory())
  const ws = await legacyWorkspace()
  await upgradeWorkspace(ws, seed, '0.2.0')

  const written = JSON.parse(await read(ws, `${MANIFEST_DIR}/${MANIFEST_FILE}`))
  assert.equal(written.seedVersion, '0.2.0')
  assert.deepEqual(written.files, manifest.files)
  assert.equal(await exists(ws, `${MANIFEST_DIR}/${HISTORY_FILE}`), false)
})

test('a folder the app never seeded is left alone', async () => {
  const { dir: seed } = await makeSeed(NEW, '0.2.0', await legacyHistory())
  const ws = await tmp('own')
  await writeTree(ws, { 'their-app/index.html': '<p>x</p>', 'README.md': 'theirs' })

  const r = await upgradeWorkspace(ws, seed, '0.2.0')

  assert.equal(r.status, 'unseeded')
  assert.deepEqual(await fs.readdir(ws), ['README.md', 'their-app'])
})

/* ---------------- workspaces with a manifest ---------------- */

test('running twice is a no-op, even with an edited file', async () => {
  const { dir: seed } = await makeSeed(NEW, '0.2.0', await legacyHistory())
  const ws = await legacyWorkspace({ 'API.md': 'edited' })
  await upgradeWorkspace(ws, seed, '0.2.0')
  await fs.rm(path.join(ws, 'API.new.md'))

  const again = await upgradeWorkspace(ws, seed, '0.2.0')

  assert.equal(again.status, 'current')
  assert.deepEqual(again.kept, [])
  assert.equal(await exists(ws, 'API.new.md'), false, 'must not recreate a sidecar the designer already dealt with')
})

test('a later seed refreshes unedited files and offers edits a new copy', async () => {
  const { manifest: m2 } = await makeSeed(NEW, '0.2.0')
  const ws = await tmp('ws2')
  await writeTree(ws, NEW)
  await writeManifest(ws, m2)
  await writeTree(ws, { 'CLAUDE.md': 'my own guidance' })

  const { dir: seed3 } = await makeSeed({ ...NEW, 'API.md': 'api v3', 'CLAUDE.md': 'guidance v3' }, '0.3.0')
  const r = await upgradeWorkspace(ws, seed3, '0.3.0')

  assert.equal(r.from, '0.2.0')
  assert.deepEqual(r.updated, ['API.md'])
  assert.deepEqual(r.kept, [{ path: 'CLAUDE.md', newCopy: 'CLAUDE.new.md' }])
})

test('a file the new seed dropped is removed only if untouched', async () => {
  const { manifest: m2 } = await makeSeed(NEW, '0.2.0')
  const ws = await tmp('ws3')
  await writeTree(ws, NEW)
  await writeManifest(ws, m2)
  await writeTree(ws, { 'types/index.d.ts': 'edited types' })

  const dropped = { ...NEW }
  delete dropped['TABLE.md']
  delete dropped['types/index.d.ts']
  const { dir: seed3 } = await makeSeed(dropped, '0.3.0')
  const r = await upgradeWorkspace(ws, seed3, '0.3.0')

  assert.deepEqual(r.removed, ['TABLE.md'])
  assert.equal(await read(ws, 'types/index.d.ts'), 'edited types')
})

test('a workspace from a newer app is not touched', async () => {
  const { dir: seed } = await makeSeed(NEW, '0.2.0')
  const ws = await tmp('ws4')
  await writeTree(ws, { ...OLD })
  await writeManifest(ws, { seedVersion: '0.9.0', files: {}, examples: [] })

  const r = await upgradeWorkspace(ws, seed, '0.2.0')

  assert.equal(r.status, 'newer')
  assert.equal(await read(ws, 'API.md'), 'api v1')
})

test('an interrupted upgrade finishes on the next run', async () => {
  const { dir: seed } = await makeSeed(NEW, '0.2.0', await legacyHistory())
  const ws = await legacyWorkspace()
  // Simulate a crash after API.md was written but before the manifest was.
  await writeTree(ws, { 'API.md': 'api v2' })

  const r = await upgradeWorkspace(ws, seed, '0.2.0')

  assert.equal(r.status, 'upgraded')
  assert.deepEqual(r.updated, ['types/index.d.ts'])
  assert.equal(await exists(ws, `${MANIFEST_DIR}/${MANIFEST_FILE}`), true)
})

/* ---------------- small pieces ---------------- */

test('sidecarName', () => {
  assert.equal(sidecarName('API.md'), 'API.new.md')
  assert.equal(sidecarName('jsconfig.json'), 'jsconfig.new.json')
  assert.equal(sidecarName('types/index.d.ts'), 'types/index.new.d.ts')
  assert.equal(sidecarName('.claude/skills/x/SKILL.md'), '.claude/skills/x/SKILL.new.md')
  assert.equal(sidecarName('.editorconfig'), '.editorconfig.new')
  assert.equal(sidecarName('LICENSE'), 'LICENSE.new')
})

test('compareVersions', () => {
  assert.equal(compareVersions('0.2.0', '0.1.1'), 1)
  assert.equal(compareVersions('0.1.1', '0.1.1'), 0)
  assert.equal(compareVersions('0.1.10', '0.1.9'), 1)
  assert.equal(compareVersions('0.2.0-beta.1', '0.2.0'), 0)
})
