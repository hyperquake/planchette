import {
  PROTOCOL_VERSION,
  type HostMessage,
  type Puck,
  type TableEventName,
  type TableState,
  type Touch,
} from '../sdk/types'
import { appSource } from './appsource'
import type { TableModel } from './model'

/**
 * Hosts a designer app in an iframe and streams table state into it.
 *
 * The iframe is laid out at the table's real pixel resolution and scaled down by
 * an ancestor transform, so one CSS pixel inside the app is always one real
 * table pixel. Only the preview shrinks, never the layout.
 */
export class AppFrame {
  readonly iframe: HTMLIFrameElement
  private connected = false
  currentApp: string | null = null
  /** While true, new touches belong to the host (the interface picker), not the app. */
  private holding = false
  /** Touches that started while holding. The app never hears of them, start to end. */
  private held = new Set<number>()

  constructor(
    iframe: HTMLIFrameElement,
    private model: TableModel,
  ) {
    this.iframe = iframe
    window.addEventListener('message', this.onMessage)
    this.applySurface()
  }

  applySurface(): void {
    const s = this.model.getSurface()
    this.iframe.style.width = `${s.widthPx}px`
    this.iframe.style.height = `${s.heightPx}px`
    this.sendConfig()
  }

  load(appId: string): void {
    this.connected = false
    this.currentApp = appId
    this.iframe.src = appSource.urlFor(appId)
  }

  reload(): void {
    if (this.currentApp) this.load(this.currentApp)
  }

  /**
   * Keep new touches away from the app, for as long as the host has something
   * on top of it. Touches the app already knows about still move and end
   * normally: an app must never be left holding a touch that never ends.
   */
  holdNewTouches(on: boolean): void {
    this.holding = on
  }

  private onMessage = (ev: MessageEvent): void => {
    if (ev.source !== this.iframe.contentWindow) return
    const m = ev.data as { __table?: number; type?: string } | undefined
    if (!m || m.__table !== PROTOCOL_VERSION || m.type !== 'hello') return

    this.connected = true
    this.sendConfig()

    // Replay what is already on the table. Without this, an app that reloads
    // (via HMR, or the Reload button) while three pucks sit on the surface comes
    // back blind, because it missed their puckadd events.
    for (const id of this.model.puckIds()) {
      const p = this.model.publicPuck(id)
      if (p) this.sendEvent('puckadd', p)
    }
    for (const id of this.model.touchIds()) {
      const t = this.model.publicTouch(id)
      if (t && !this.held.has(id)) this.post({ __table: PROTOCOL_VERSION, type: 'event', name: 'touchstart', data: t })
    }
  }

  sendConfig(): void {
    this.post({
      __table: PROTOCOL_VERSION,
      type: 'config',
      surface: this.model.getSurface(),
      state: this.snapshot(),
    })
  }

  sendState(): void {
    this.post({ __table: PROTOCOL_VERSION, type: 'state', state: this.snapshot() })
  }

  sendEvent(name: TableEventName, data: Puck | Touch): void {
    if (name === 'touchstart' && this.holding) {
      this.held.add(data.id)
      return
    }
    if ((name === 'touchmove' || name === 'touchend') && this.held.has(data.id)) {
      if (name === 'touchend') this.held.delete(data.id)
      return
    }
    this.post({ __table: PROTOCOL_VERSION, type: 'event', name, data })
  }

  /** The model's state, minus any touch the app was never told about. */
  private snapshot(): TableState {
    const s = this.model.snapshot()
    return this.held.size ? { ...s, touches: s.touches.filter((t) => !this.held.has(t.id)) } : s
  }

  private post(msg: HostMessage): void {
    if (!this.connected) return
    this.iframe.contentWindow?.postMessage(msg, '*')
  }
}
