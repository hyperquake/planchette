import { defineConfig } from 'vite'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

/**
 * Bundles Three.js into dist/three.js so the packaged app can offer `three` as a
 * bare specifier through the injected import map, the same way it offers
 * `@table/sdk`. Minified, unlike the SDK: nobody reads vendor code.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2022',
    minify: true,
    lib: {
      entry: resolve(root, 'src/vendor/three.ts'),
      formats: ['es'],
      fileName: () => 'three.js',
    },
  },
})
