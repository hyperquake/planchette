import { defineConfig } from 'vite'
import { readdirSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

/**
 * Every folder under apps/ that has an index.html becomes a build entry, so
 * designer apps survive `npm run build` and not just the dev server.
 */
function entries(): Record<string, string> {
  const out: Record<string, string> = { host: resolve(root, 'index.html') }
  for (const name of readdirSync(resolve(root, 'apps'))) {
    const index = resolve(root, 'apps', name, 'index.html')
    try {
      if (statSync(index).isFile()) out[`app-${name}`] = index
    } catch {
      /* not an app folder */
    }
  }
  return out
}

export default defineConfig({
  resolve: {
    // Designer apps import from '@table/sdk' rather than a relative path.
    alias: { '@table/sdk': resolve(root, 'src/sdk/index.ts') },
  },
  build: {
    target: 'es2022',
    rollupOptions: { input: entries() },
  },
})
