/**
 * Where interfaces come from.
 *
 * In the browser they are the example folders in this repo, discovered at build
 * time and served by Vite from `/examples/`. In the packaged desktop app they
 * live in a workspace folder on the user's disk, listed over IPC and served from
 * `/workspace/` by the custom protocol handler.
 *
 * The paths differ; the origin does not. That is what matters: one origin means
 * no CORS, and `urlFor` is the single place that knows the difference, so nothing
 * downstream has to.
 */

/** Implemented by electron/preload.cjs. Absent in a plain browser. */
export interface WorkspaceList {
  current: string
  /** Most recent first. */
  recent: string[]
}

export interface DesktopBridge {
  listApps(): Promise<string[]>
  workspacePath(): Promise<string>
  listWorkspaces(): Promise<WorkspaceList>
  useWorkspace(dir: string): Promise<WorkspaceList>
  forgetWorkspace(dir: string): Promise<WorkspaceList>
  chooseWorkspace(): Promise<WorkspaceList | null>
  reveal(appId?: string): Promise<void>
  createInterface(name: string): Promise<string>
  onAppsChanged(cb: (appId: string | null) => void): void
  onReloadApp(cb: () => void): void
  onChooseWorkspace(cb: () => void): void
  onOpenSettings(cb: () => void): void
  onToggleInspector(cb: () => void): void
  onAbout(cb: () => void): void
  onForgetWorkspace(cb: () => void): void
  onNewInterface(cb: () => void): void
  version: string
}

export interface Workspace {
  path(): Promise<string>
  list(): Promise<WorkspaceList>
  use(dir: string): Promise<WorkspaceList>
  forget(dir: string): Promise<WorkspaceList>
  choose(): Promise<WorkspaceList | null>
  reveal(appId?: string): Promise<void>
  createInterface(name: string): Promise<string>
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
 * Folder names under examples/ with an index.html. The glob is not eager, so
 * this costs nothing at runtime; we only want the keys.
 */
const WEB_APPS: string[] = Object.keys(import.meta.glob('/examples/*/index.html'))
  .map((p) => p.split('/')[2]!)
  .sort()

function webSource(): AppSource {
  return {
    kind: 'web',
    list: async () => WEB_APPS,
    // BASE_URL, not a leading slash: the redistributable web build is served
    // from wherever the site puts it, with no deploy path baked in.
    urlFor: (id) => `${import.meta.env.BASE_URL}examples/${id}/index.html`,
    // Vite's own client reloads the iframe on save, so there is nothing to do.
    onChange: () => {},
    workspace: null,
  }
}

function desktopSource(bridge: DesktopBridge): AppSource {
  return {
    kind: 'desktop',
    list: () => bridge.listApps(),
    urlFor: (id) => `${import.meta.env.BASE_URL}workspace/${id}/index.html`,
    onChange: (cb) => bridge.onAppsChanged(cb),
    workspace: {
      path: () => bridge.workspacePath(),
      list: () => bridge.listWorkspaces(),
      use: (dir) => bridge.useWorkspace(dir),
      forget: (dir) => bridge.forgetWorkspace(dir),
      choose: () => bridge.chooseWorkspace(),
      reveal: (appId) => bridge.reveal(appId),
      createInterface: (name) => bridge.createInterface(name),
    },
  }
}

export const appSource: AppSource = window.planchette ? desktopSource(window.planchette) : webSource()
