/**
 * Assembles workspace-seed/, which is what gets copied into a designer's
 * workspace the first time the packaged app runs.
 *
 * A coworker who opens that folder in an editor or a coding agent should have
 * everything needed to write an interface: two examples, the design rules, and
 * SDK type declarations wired up so `@planchette/sdk` resolves.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildManifest, HISTORY_FILE, MANIFEST_DIR, MANIFEST_FILE } from '../electron/workspace-upgrade.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'workspace-seed')
const EXAMPLES = ['_template', 'dial-demo', 'radial-atlas', 'arcane-table']

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
  await fs.cp(path.join(root, 'examples', name), path.join(out, name), { recursive: true })
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
        paths: { '@planchette/sdk': ['./types/index.d.ts'] },
      },
      include: ['.'],
    },
    null,
    2,
  ) + '\n',
)

// Reference docs land beside the interfaces, so an agent working in this folder
// can read the real API rather than guess at it.
for (const doc of ['API.md', 'PROTOCOL.md', 'DESIGN-RULES.md']) {
  await fs.copyFile(path.join(root, 'docs', doc), path.join(out, doc))
}

// One body of guidance, composed from the workspace intro plus the shared design
// rules, so the rules never drift between the repo and a designer's folder.
const intro = await fs.readFile(path.join(root, 'docs', 'WORKSPACE-INTRO.md'), 'utf8')
const rules = await fs.readFile(path.join(root, 'docs', 'DESIGN-RULES.md'), 'utf8')
const guidance = `${intro.trimEnd()}\n\n---\n\n${rules.trimStart()}`

// CLAUDE.md and AGENTS.md carry identical content on purpose. Different tools
// look for different filenames, and both are generated, so they cannot drift.
await fs.writeFile(path.join(out, 'CLAUDE.md'), guidance)
await fs.writeFile(path.join(out, 'AGENTS.md'), guidance)

// A skill, which beats a context file in the case that actually matters: someone
// opens a coding agent on one interface folder and starts typing. It is retrieved
// on relevance rather than needing to be in context already.
const skillDir = path.join(out, '.claude', 'skills', 'planchette-interface')
await fs.mkdir(skillDir, { recursive: true })
await fs.writeFile(
  path.join(skillDir, 'SKILL.md'),
  `---
name: planchette-interface
description: Build or edit an interface for the Planchette touch-table simulator. Use whenever the work involves pucks, markers, a table surface, tangible objects on a display, radial or rune menus on a table, multi-touch with several simultaneous users, or the @planchette/sdk. Covers the SDK API, millimetre-first sizing, and the multi-user design rules that laptop instincts get wrong.
---

# Writing a Planchette interface

You are working on an interface for a large multitouch table that also tracks
**pucks**: physical objects placed on the surface, each reporting its own
identity, position, and rotation. The hardware is a 55 inch 4K panel, 1218 x 685
millimetres, that several people use at once.

## Read these first

- \`DESIGN-RULES.md\` in the workspace root. Short, and it decides whether the
  interface works on real hardware.
- \`API.md\` in the workspace root for the complete SDK reference.

## The minimum you need

\`\`\`js
import { table } from '@planchette/sdk'

table.ready(({ surface }) => {
  requestAnimationFrame(function loop() {
    const { pucks, touches } = table.state()
    for (const p of pucks) {
      // p.mmX / p.mmY are millimetres. p.angle is radians, 0 = up, clockwise.
      place(el, table.mm(p.mmX), table.mm(p.mmY), p.angle)
    }
    requestAnimationFrame(loop)
  })
})

table.on('puckadd', (p) => {})      // also puckmove, puckremove
table.on('touchstart', (t) => {})   // also touchmove, touchend
\`\`\`

Pull state in a render loop for anything that draws; use events for discrete
moments. In CSS size everything with \`calc(20 * var(--mm))\`.

## The mistakes to avoid

- Sizing in pixels. The viewport is 3840x2160, not a laptop window. Touch targets
  are 15mm minimum, 20mm preferred.
- Hover states. There is no cursor on a table.
- Modal dialogs, global focus, or a single \`selectedItem\`. Several people act at
  once, so every interaction must be scoped to a specific touch or puck id.
- Keying state by puck \`id\`. That is a tracking session and changes when a marker
  is re-acquired. Key by \`markerId\`.
- Treating \`puckremove\` as final. Tracking flickers; fade with a grace period.
- Drawing anything meaningful inside \`var(--puck-d)\`. A hand is there.
- Letting an event handler depend on the render loop, either for a computed value
  or for object creation. It fails intermittently.
- In WebGL: passing \`devicePixelRatio\` to the renderer, or using \`THREE.Line\`
  (clamped to one pixel, which is 0.3mm here).

An interface folder is an ordinary static site: any local file at any depth, plus
remote https URLs. \`@planchette/sdk\` and \`three\` resolve with no install.
`,
)

// The manifest is what lets a later app upgrade this workspace without touching
// anything the designer changed: it records the hash of every file the app owns.
// History covers workspaces from releases that predate the manifest. It stays in
// the seed and is never copied into a workspace. See electron/workspace-upgrade.js.
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
const manifest = await buildManifest(out, pkg.version)
await fs.mkdir(path.join(out, MANIFEST_DIR), { recursive: true })
await fs.writeFile(path.join(out, MANIFEST_DIR, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n')
await fs.copyFile(path.join(root, 'scripts', 'seed-history.json'), path.join(out, MANIFEST_DIR, HISTORY_FILE))

const listed = (await fs.readdir(out)).sort().join(', ')
console.log(`workspace-seed/ built: ${listed}`)
