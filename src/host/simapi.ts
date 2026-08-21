import type { TableState } from '../sdk/types'
import type { AppFrame } from './appframe'
import type { TableModel } from './model'

export interface SimApi {
  addPuck(opts: { markerId?: number; mmX: number; mmY: number; angleDeg?: number }): number
  movePuck(id: number, opts: { mmX?: number; mmY?: number; angleDeg?: number }): void
  removePuck(id: number): void
  touch(opts: { mmX: number; mmY: number; radiusMm?: number }): number
  moveTouch(id: number, opts: { mmX?: number; mmY?: number }): void
  endTouch(id: number): void
  clear(): void
  loadApp(appId: string): void
  /** Show or hide the inspector, for scripted scenes and screenshots. */
  showInspector(on: boolean): void
  reload(): void
  state(): TableState
  /** Ids of the apps currently available. */
  readonly apps: string[]
}

/**
 * Exposed as window.sim. Every mutation the toolbar and input layer perform goes
 * through the same model, so this is a real control surface rather than a
 * parallel one: it is how the simulator gets driven from the console, and it is
 * the seam that record/replay, scripted gestures, and agent driving hang off.
 *
 * Takes millimetres and degrees, because that is what a human reasons in.
 */
export function installSimApi(
  model: TableModel,
  frame: AppFrame,
  apps: () => string[],
  /** Selects an interface the way the picker does, so the two cannot disagree. */
  selectApp: (appId: string) => void,
  /** Shows or hides the inspector through the same path the menu uses. */
  showInspector: (on: boolean) => void,
): SimApi {
  const toNorm = (mmX: number, mmY: number) => {
    const s = model.getSurface()
    return { x: mmX / s.widthMm, y: mmY / s.heightMm }
  }
  const rad = (deg: number | undefined) => (deg === undefined ? undefined : (deg * Math.PI) / 180)

  const sim: SimApi = {
    addPuck({ markerId = 1, mmX, mmY, angleDeg = 0 }) {
      const { x, y } = toNorm(mmX, mmY)
      return model.addPuck({ markerId, x, y, angle: rad(angleDeg) })
    },
    movePuck(id, { mmX, mmY, angleDeg }) {
      const s = model.getSurface()
      model.movePuck(id, {
        x: mmX === undefined ? undefined : mmX / s.widthMm,
        y: mmY === undefined ? undefined : mmY / s.heightMm,
        angle: rad(angleDeg),
      })
    },
    removePuck: (id) => model.removePuck(id),
    touch({ mmX, mmY, radiusMm }) {
      const { x, y } = toNorm(mmX, mmY)
      return model.addTouch({ x, y, radiusMm, sticky: true })
    },
    moveTouch(id, { mmX, mmY }) {
      const s = model.getSurface()
      model.moveTouch(id, {
        x: mmX === undefined ? undefined : mmX / s.widthMm,
        y: mmY === undefined ? undefined : mmY / s.heightMm,
      })
    },
    endTouch: (id) => model.removeTouch(id),
    clear: () => model.clear(),
    // Goes through the same path as the picker: calling frame.load directly left
    // the dropdown showing a different interface than the one on screen.
    loadApp: (appId) => selectApp(appId),
    showInspector: (on) => showInspector(Boolean(on)),
    reload: () => frame.reload(),
    state: () => model.snapshot(),
    // A getter, because the desktop build discovers apps at runtime and the
    // list changes when the user adds a folder or switches workspace.
    get apps() {
      return apps()
    },
  }

  ;(window as unknown as { sim: SimApi }).sim = sim
  return sim
}
