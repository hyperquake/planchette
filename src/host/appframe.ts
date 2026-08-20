import { PROTOCOL_VERSION, type HostMessage, type Puck, type TableEventName, type Touch } from '../sdk/types'
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

  constructor(iframe: HTMLIFrameElement, private model: TableModel) {
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
      if (t) this.sendEvent('touchstart', t)
    }
  }

  sendConfig(): void {
    this.post({
      __table: PROTOCOL_VERSION,
      type: 'config',
      surface: this.model.getSurface(),
      state: this.model.snapshot(),
    })
  }

  sendState(): void {
    this.post({ __table: PROTOCOL_VERSION, type: 'state', state: this.model.snapshot() })
  }

  sendEvent(name: TableEventName, data: Puck | Touch): void {
    this.post({ __table: PROTOCOL_VERSION, type: 'event', name, data })
  }

  private post(msg: HostMessage): void {
    if (!this.connected) return
    this.iframe.contentWindow?.postMessage(msg, '*')
  }
}
