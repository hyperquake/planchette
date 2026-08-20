# Radial Atlas

A worked example of two things: nested radial menus driven by a puck, and
loading real content into an interface.

- `lib/menu.js` holds the interaction model. Read the comment at the top before
  changing behaviour; the rules about what commits and what merely highlights are
  the difference between a nested radial menu that works on a table and one that
  fires by accident.
- `content/content.json` is the data. `content/images/*.svg` are the plates.
- Ring radii live in `RINGS` in `lib/menu.js`, in millimetres from the puck
  centre. Adding a third entry adds a third level.

An interface folder is an ordinary static site. Reference any local file at any
depth, and remote https URLs too, including ES module imports from a CDN.
