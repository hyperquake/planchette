/**
 * Remove every generated directory.
 *
 * Exists mainly for local builds: release/ and the other generated folders are
 * gitignored, so they survive between builds, and stale artifacts from an older
 * version would be picked up alongside the new ones. Node rather than `rm -rf` so the same
 * command works on Windows.
 */
import { rm } from 'node:fs/promises'

const TARGETS = ['dist', 'dist-types', 'workspace-seed', 'release']

for (const dir of TARGETS) {
  await rm(dir, { recursive: true, force: true })
}
console.log(`cleaned: ${TARGETS.join(', ')}`)
