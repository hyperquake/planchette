/**
 * Keep the SDK's reported version equal to the app's.
 *
 * The SDK announces itself in its `hello` and exposes `table.version`, and it is
 * served by the app, so the two are one release. Run by npm's `version` lifecycle
 * script, so `npm version 0.2.0 --no-git-tag-version` updates both;
 * scripts/check-version.mjs refuses a release where they differ.
 *
 *   node scripts/sync-sdk-version.mjs           # write
 *   node scripts/sync-sdk-version.mjs --check   # exit 1 if they differ
 */
import { readFile, writeFile } from 'node:fs/promises'

const FILE = 'src/sdk/transport.ts'
const PATTERN = /export const SDK_VERSION = '([^']*)'/

const { version } = JSON.parse(await readFile('package.json', 'utf8'))
const src = await readFile(FILE, 'utf8')
const current = PATTERN.exec(src)?.[1]
if (current === undefined) {
  console.error(`${FILE} has no SDK_VERSION line in the expected form`)
  process.exit(2)
}

if (process.argv.includes('--check')) {
  if (current !== version) {
    console.error(`SDK_VERSION is ${current} but package.json is ${version}. Run: node scripts/sync-sdk-version.mjs`)
    process.exit(1)
  }
  console.log(`SDK_VERSION ${current} matches package.json`)
} else if (current !== version) {
  await writeFile(FILE, src.replace(PATTERN, `export const SDK_VERSION = '${version}'`))
  console.log(`SDK_VERSION ${current} -> ${version}`)
}
