/**
 * Where designer apps come from.
 *
 * In the browser they are folders in this repo, discovered at build time and
 * served by Vite. In the packaged desktop app they live in a workspace folder on
 * the user's disk, listed over IPC and served by the custom protocol handler.
 *
 * Both serve apps at the same URL path, `/apps/<id>/index.html`, so nothing
 * downstream of here has to care which one it is talking to.
 */

/** Implemented by electron/preload.cjs. Absent in a plain browser. */
export interface DesktopBridge {
  listApps(): Promise<string[]>
  workspacePath(): Promise<string>
  chooseWorkspace(): Promise<string | null>
  reveal(appId?: string): Promise<void>
  createApp(name: string): Promise<string>
  onAppsChanged(cb: (appId: string | null) => void): void
  onReloadApp(cb: () => void): void
  onChooseWorkspace(cb: () => void): void
  version: string
}

export interface Workspace {
  path(): Promise<string>
  choose(): Promise<string | null>
  reveal(appId?: string): Promise<void>
  createApp(name: string): Promise<string>
}

export interface AppSource {
  kind: 'web' | 'desktop'
  list(): Promise<string[]>
  urlFor(appId: string): string
  /** Fires when files under an app change. Null means "something, unsure what". */
  onChange(cb: (appId: string | null) => void): void
  /** Only present when apps live in a folder the user can edit. */
  workspace: Workspace | null
}

declare global {
  interface Window {
    planchette?: DesktopBridge
  }
}

/**
 * Folder names under apps/ with an index.html. The glob is not eager, so this
 * costs nothing at runtime; we only want the keys.
 */
const WEB_APPS: string[] = Object.keys(import.meta.glob('/apps/*/index.html'))
  .map((p) => p.split('/')[2]!)
  .sort()

const urlFor = (appId: string): string => `/apps/${appId}/index.html`

function webSource(): AppSource {
  return {
    kind: 'web',
    list: async () => WEB_APPS,
    urlFor,
    // Vite's own client reloads the iframe on save, so there is nothing to do.
    onChange: () => {},
    workspace: null,
  }
}

function desktopSource(bridge: DesktopBridge): AppSource {
  return {
    kind: 'desktop',
    list: () => bridge.listApps(),
    urlFor,
    onChange: (cb) => bridge.onAppsChanged(cb),
    workspace: {
      path: () => bridge.workspacePath(),
      choose: () => bridge.chooseWorkspace(),
      reveal: (appId) => bridge.reveal(appId),
      createApp: (name) => bridge.createApp(name),
    },
  }
}

export const appSource: AppSource = window.planchette ? desktopSource(window.planchette) : webSource()
