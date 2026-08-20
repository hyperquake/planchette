import { table } from '@table/sdk'

const hint = document.getElementById('hint')
const rings = new Map() // puck id -> element

table.ready(({ surface }) => {
  console.log(`[app] ${surface.label}: ${surface.widthPx}x${surface.heightPx}px, ${surface.pxPerMm.toFixed(2)} px/mm`)

  // Pull the state each frame. This is the easier pattern for anything that
  // draws, because you never maintain your own copy of what is on the table.
  requestAnimationFrame(function loop() {
    const { pucks } = table.state()
    hint.style.opacity = pucks.length ? 0 : 1

    for (const p of pucks) {
      let el = rings.get(p.id)
      if (!el) {
        el = document.createElement('div')
        el.className = 'marker'
        document.body.appendChild(el)
        rings.set(p.id, el)
      }
      // p.mmX / p.mmY are millimetres. table.mm() converts to pixels.
      el.style.transform = `translate(${table.mm(p.mmX)}px, ${table.mm(p.mmY)}px) rotate(${p.angle}rad)`
    }

    for (const [id, el] of rings) {
      if (!table.puckById(id)) {
        el.remove()
        rings.delete(id)
      }
    }

    requestAnimationFrame(loop)
  })
})

// Push events, for the discrete moments that matter.
table.on('puckadd', (p) => console.log('puck on:', p.markerId))
table.on('puckremove', (p) => console.log('puck off:', p.markerId))
table.on('touchstart', (t) => console.log(`touch at ${t.mmX.toFixed(0)},${t.mmY.toFixed(0)}mm from the ${t.edge} edge`))
