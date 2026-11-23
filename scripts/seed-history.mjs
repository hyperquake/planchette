/**
 * Records what the workspace seed held in released versions that predate the
 * seed manifest, so a workspace created by one of them can still be upgraded
 * safely: a file is only replaced if it matches what that release wrote.
 *
 *   node scripts/seed-history.mjs v0.1.0 v0.1.1
 *
 * Rebuilds each tag's seed in a throwaway git worktree, using this checkout's
 * node_modules, and writes scripts/seed-history.json. Only versions without a
 * manifest need to be here: from 0.2.0 on, each workspace records its own.
 * The output is committed; this is not part of the normal build.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildManifest } from '../electron/workspace-upgrade.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'scripts', 'seed-history.json')
const tags = process.argv.slice(2)
if (!tags.length) {
  console.error('usage: node scripts/seed-history.mjs <tag> [<tag>...]')
  process.exit(1)
}

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })

const history = {}
for (const tag of tags) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `planchette-seed-${tag}-`))
  try {
    run('git', ['worktree', 'add', '--detach', dir, tag], root)
    await fs.symlink(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'junction')
    run('npx', ['tsc', '-p', 'tsconfig.sdk.json'], dir)
    run('node', ['scripts/build-seed.mjs'], dir)
    const version = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')).version
    const { files, examples } = await buildManifest(path.join(dir, 'workspace-seed'), version)
    history[version] = { files, examples }
  } finally {
    run('git', ['worktree', 'remove', '--force', dir], root)
  }
}

await fs.writeFile(out, JSON.stringify(history, null, 2) + '\n')
console.log(`wrote ${path.relative(root, out)}: ${Object.keys(history).join(', ')}`)
