/**
 * Telling a designer what an upgrade did to their workspace.
 *
 * Non-modal and dismissible: it is news, not a question. Built from DOM nodes
 * rather than markup, because every path in it comes off the user's disk.
 */

export interface UpgradeReport {
  status: string
  from: string | null
  to: string
  added: string[]
  updated: string[]
  kept: Array<{ path: string; newCopy: string }>
  removed: string[]
  examplesAdded: string[]
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  return node
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function showUpgradeNotice(report: UpgradeReport, reveal: () => void): void {
  document.getElementById('ws-notice')?.remove()

  const box = el('div')
  box.id = 'ws-notice'
  box.setAttribute('role', 'status')

  box.append(el('h3', `Workspace updated for Planchette ${report.to}`))

  const refreshed = report.updated.length + report.added.length
  if (refreshed) {
    box.append(el('p', `${plural(refreshed, 'reference file')} (docs, SDK types, agent guidance) brought up to date.`))
  }
  if (report.examplesAdded.length) {
    box.append(el('p', `New example: ${report.examplesAdded.join(', ')}.`))
  }
  if (report.kept.length) {
    box.append(
      el(
        'p',
        `You had edited ${plural(report.kept.length, 'file')}, so they were left alone. The new versions are beside them:`,
      ),
    )
    const list = el('ul')
    for (const k of report.kept) {
      const li = el('li')
      li.append(el('code', k.path), ' → ', el('code', k.newCopy))
      list.append(li)
    }
    box.append(list)
  }
  if (!refreshed && !report.kept.length && !report.examplesAdded.length) {
    box.append(el('p', 'Nothing needed changing.'))
  }
  box.append(el('p', 'Your interfaces were not touched.'))

  const row = el('div')
  row.className = 'ws-notice-row'
  const open = el('button', 'Open folder')
  open.addEventListener('click', reveal)
  const close = el('button', 'Dismiss')
  close.addEventListener('click', () => box.remove())
  row.append(open, close)
  box.append(row)

  document.body.append(box)
}
