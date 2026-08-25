import { defineConfig, type Plugin } from 'vite'
import { cpSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

/**
 * Every folder under examples/ that has an index.html becomes a build entry, so
 * the examples survive `npm run build` and not just the dev server.
 */
function entries(): Record<string, string> {
  const out: Record<string, string> = { host: resolve(root, 'index.html') }
  for (const name of readdirSync(resolve(root, 'examples'))) {
    const index = resolve(root, 'examples', name, 'index.html')
    try {
      if (statSync(index).isFile()) out[`example-${name}`] = index
    } catch {
      /* not an example folder */
    }
  }
  return out
}

/**
 * Copy each example folder into the build verbatim, minus the page Vite already
 * emitted and the notes nobody serves.
 *
 * An interface may fetch its own files at runtime, and a runtime fetch is
 * invisible to the bundler: radial-atlas reads content/content.json and every
 * plate SVG that way, so a build without this plugin ships the page and none of
 * its content. Copying the rest of the folder verbatim also matches what the
 * desktop app does, where the workspace folder is served as-is, so an interface
 * that works in the app works in a static build too.
 *
 * The example's own main.js and lib/ get copied as well and go unused, since the
 * built page points at the hashed bundle. That is a few unreferenced kilobytes in
 * exchange for a rule with no exceptions.
 */
function copyExampleAssets(): Plugin {
  // Read from the resolved config rather than assuming dist/: the embed test
  // builds into its own directory, and hardcoding this shipped the example pages
  // without any of the files they fetch at runtime.
  let buildOutDir = 'dist'
  return {
    name: 'planchette-copy-example-assets',
    apply: 'build',
    configResolved(config) {
      buildOutDir = config.build.outDir
    },
    closeBundle() {
      const outDir = resolve(root, buildOutDir, 'examples')
      for (const name of readdirSync(resolve(root, 'examples'))) {
        const from = resolve(root, 'examples', name)
        try {
          if (!statSync(from).isDirectory()) continue
        } catch {
          continue
        }
        cpSync(from, resolve(outDir, name), {
          recursive: true,
          filter: (src) => !/(?:index\.html|\.md)$/i.test(src),
        })
      }
    },
  }
}

export default defineConfig({
  // Relative by default is wrong for the dev server, so the override is what the
  // redistributable web artifact uses: PLANCHETTE_BASE=./ bakes in no deploy path.
  base: process.env.PLANCHETTE_BASE || '/',
  plugins: [copyExampleAssets()],
  // Read once at build time so the about panel can state the version without
  // importing package.json into the bundle.
  define: {
    __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version),
  },
  resolve: {
    // Designer apps import from '@planchette/sdk' rather than a relative path.
    alias: { '@planchette/sdk': resolve(root, 'src/sdk/index.ts') },
  },
  build: {
    target: 'es2022',
    rollupOptions: { input: entries() },
  },
})
