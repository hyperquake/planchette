/**
 * Remove every generated directory.
 *
 * Exists mainly for self-hosted runners: they keep their working directory
 * between runs, and release/ is gitignored, so `actions/checkout` will not clear
 * it. Stale artifacts from an older version would then be picked up by an upload
 * glob and shipped alongside the new ones. Node rather than `rm -rf` so the same
 * command works on Windows.
 */
import { rm } from 'node:fs/promises'

const TARGETS = ['dist', 'dist-types', 'workspace-seed', 'release']

for (const dir of TARGETS) {
  await rm(dir, { recursive: true, force: true })
}
console.log(`cleaned: ${TARGETS.join(', ')}`)
