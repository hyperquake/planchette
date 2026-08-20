/**
 * Assembles workspace-seed/, which is what gets copied into a designer's
 * workspace the first time the packaged app runs.
 *
 * A coworker who opens that folder in an editor or a coding agent should have
 * everything needed to write an interface: two examples, the design rules, and
 * SDK type declarations wired up so `@table/sdk` resolves.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'workspace-seed')
const EXAMPLES = ['_template', 'dial-demo']

async function exists(p) {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

const types = path.join(root, 'dist-types')
if (!(await exists(types))) {
  console.error('missing dist-types/. Run `npm run build:types` first.')
  process.exit(1)
}

await fs.rm(out, { recursive: true, force: true })
await fs.mkdir(out, { recursive: true })

for (const name of EXAMPLES) {
  await fs.cp(path.join(root, 'apps', name), path.join(out, name), { recursive: true })
}

await fs.cp(types, path.join(out, 'types'), { recursive: true })

// So that editors and coding agents resolve the bare specifier to real types.
await fs.writeFile(
  path.join(out, 'jsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        moduleResolution: 'bundler',
        allowJs: true,
        checkJs: false,
        noEmit: true,
        baseUrl: '.',
        paths: { '@table/sdk': ['./types/index.d.ts'] },
      },
      include: ['.'],
    },
    null,
    2,
  ) + '\n',
)

// One CLAUDE.md, composed from the workspace-specific intro plus the shared
// rules, so the rules never drift between the repo and a designer's folder.
const intro = await fs.readFile(path.join(root, 'docs', 'WORKSPACE-INTRO.md'), 'utf8')
const rules = await fs.readFile(path.join(root, 'docs', 'HOUSE-RULES.md'), 'utf8')
await fs.writeFile(path.join(out, 'CLAUDE.md'), `${intro.trimEnd()}\n\n---\n\n${rules.trimStart()}`)

const listed = (await fs.readdir(out)).sort().join(', ')
console.log(`workspace-seed/ built: ${listed}`)
