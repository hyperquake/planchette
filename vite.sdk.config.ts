import { defineConfig } from 'vite'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

/**
 * A standalone ESM build of the SDK, emitted into dist/ alongside the host UI.
 *
 * The packaged app serves this at /sdk.js and injects an import map so that a
 * designer app's `import { table } from '@planchette/sdk'` resolves without a
 * bundler. Left unminified on purpose: designers do read it.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    // The host build runs first and owns dist/; do not wipe it.
    emptyOutDir: false,
    target: 'es2022',
    minify: false,
    lib: {
      entry: resolve(root, 'src/sdk/index.ts'),
      formats: ['es'],
      fileName: () => 'sdk.js',
    },
  },
})
