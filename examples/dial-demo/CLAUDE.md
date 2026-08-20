# Dial demo

A puck used as a rotary dial. The shortest complete example: read this one first.

Each puck grows its own ring of options. Rotating the puck moves the highlight;
touching the ring confirms it. Everything is DOM plus CSS transforms, which is
the right default for panels, cards, and menus.

Worth noticing in `main.js`, because these are the habits that survive real
hardware:

- Dials are keyed by `markerId`, not by puck `id`. An `id` is a tracking session
  and changes whenever the tracker loses and re-acquires a marker.
- `puckremove` starts a fade rather than deleting, so a momentary dropout does
  not throw away the user's state.
- The selected option is derived from the puck's angle on demand, never cached by
  the render loop and read from a handler.
- Nothing is drawn inside the puck footprint. A hand is there.

Read `../DESIGN-RULES.md` before changing behaviour. The API is `../API.md`.
