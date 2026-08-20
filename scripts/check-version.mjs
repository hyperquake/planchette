/**
 * Refuse to build a release whose tag disagrees with package.json.
 *
 * electron-builder names every artifact from the package.json version, so a
 * mismatch produces a v0.2.0 release full of files called 0.1.0. The fix is to
 * fail loudly here rather than have CI rewrite the repo behind your back.
 *
 *   node scripts/check-version.mjs v0.2.0
 */
import { readFile } from 'node:fs/promises'

const raw = process.argv[2]
if (!raw) {
  console.error('usage: node scripts/check-version.mjs <tag>')
  process.exit(2)
}

const tag = raw.replace(/^refs\/tags\//, '').replace(/^v/, '')
const { version } = JSON.parse(await readFile('package.json', 'utf8'))

if (tag !== version) {
  console.error(
    `Tag and package.json disagree.\n` +
      `  tag:          ${raw}  (parsed as ${tag})\n` +
      `  package.json: ${version}\n\n` +
      `Bump the version, commit, then move the tag:\n` +
      `  npm version ${tag} --no-git-tag-version\n` +
      `  git commit -am "Release ${tag}" && git tag -f v${tag} && git push --follow-tags --force-with-lease`,
  )
  process.exit(1)
}
console.log(`version ${version} matches tag ${raw}`)
