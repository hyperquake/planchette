import type { DesktopBridge } from './appsource'
import type { TableConfig, TuioStatus } from './tuio'

/**
 * The Settings section for a real table: one switch, and what the listener is
 * doing. Mapping and calibration have their own dialog (enroll.ts), because
 * they need a table in front of you; this switch is useful on any machine with
 * a TUIO simulator.
 */
export function setupTableSettings(
  bridge: DesktopBridge,
  onStatus: (s: TuioStatus | null) => void,
): { config: () => TableConfig | null } {
  const box = document.getElementById('tuio-enabled') as HTMLInputElement
  const where = document.getElementById('tuio-where')!
  const state = document.getElementById('tuio-state')!
  let config: TableConfig | null = null

  const drawConfig = (c: TableConfig) => {
    config = c
    box.checked = c.tuio.enabled
    where.textContent = `UDP ${c.tuio.host}:${c.tuio.port}`
  }

  const drawStatus = (s: TuioStatus | null) => {
    onStatus(s)
    state.classList.toggle('bad', s?.state === 'error')
    if (!s || s.state === 'off') state.textContent = ''
    else if (s.state === 'error') state.textContent = s.error ?? 'error'
    else if (s.state === 'listening') state.textContent = `Listening. ${s.packetsPerSec} packets/s.`
    else state.textContent = 'Starting…'
  }

  box.addEventListener('change', async () => {
    if (!config) return
    drawConfig(await bridge.saveTableConfig({ ...config, tuio: { ...config.tuio, enabled: box.checked } }))
  })

  bridge.onTableChanged(drawConfig)
  bridge.onTuioStatus(drawStatus)
  void bridge.tableConfig().then(drawConfig)
  void bridge.tuioStatus().then(drawStatus)

  return { config: () => config }
}
