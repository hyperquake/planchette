/**
 * Build the redistributable web artifact and zip it.
 *
 * Built with a relative base, so no deployment path is baked in and the same zip
 * works at hyperquake.com/planchette/embed/, at a preview URL, or unpacked into a
 * local folder. A site repo pins a version of this rather than tracking main,
 * which keeps published claims anchored to a release.
 *
 * Invokes vite through its own api rather than spawning npm: npm is npm.cmd on
 * Windows, and node refuses to spawn a .cmd without a shell.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { build } from 'vite'

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const artifact = `planchette-web-${version}.zip`

// Relative base has to be set before the configs are loaded.
process.env.PLANCHETTE_BASE = './'

for (const configFile of ['vite.config.ts', 'vite.sdk.config.ts', 'vite.vendor.config.ts']) {
  await build({ configFile, logLevel: 'warn' })
}

mkdirSync('release', { recursive: true })
rmSync(`release/${artifact}`, { force: true })

try {
  // Zip the contents of dist, not dist itself, so unpacking gives a servable root.
  execFileSync('zip', ['-r', '-q', `../release/${artifact}`, '.'], { cwd: 'dist', stdio: 'inherit' })
} catch (err) {
  console.error(
    `could not create ${artifact}. This needs the zip command, which macOS and ` +
      `Linux have and Windows generally does not. The artifact is platform ` +
      `independent, so build it on the mac runner.`,
  )
  throw err
}

console.log(`release/${artifact}`)
