import { defineConfig } from 'vite'
import { readdirSync, statSync } from 'node:fs'
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

export default defineConfig({
  resolve: {
    // Designer apps import from '@planchette/sdk' rather than a relative path.
    alias: { '@planchette/sdk': resolve(root, 'src/sdk/index.ts') },
  },
  build: {
    target: 'es2022',
    rollupOptions: { input: entries() },
  },
})
