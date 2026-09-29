# Visual

A local-first desktop design editor for UI mockups, posters and social visuals: open it, get a canvas, draw a frame,
build something, save it and export it. Its companion is [Motion Studio](https://github.com/tinygusie2/motion-studio):
Visual designs, Motion Studio animates, and designs go across **layer by layer** instead of as a flat screenshot.
That is why every layer has an id that never changes (`node_3fa92c01b7de`).

## Status: step 4 of 5

| Step | What | |
| --- | --- | --- |
| 1 | Start screen, `.visual` files, infinite canvas, frames, rectangle, ellipse, text, layers, pages, select / move / resize, undo | ✅ |
| 2 | Snapping with distances, alignment, groups, gradients, strokes, shadows and blur, PNG/SVG export, colour picker | ✅ |
| 3 | Auto layout, constraints, images, SVG import, autosave and recovery | ✅ |
| 4 | Components, instances and overrides, colour variables, assets panel | ✅ |
| 5 | Open in Motion Studio, with linked designs (update, missing layers, detach) | |

## Running it

Needs [Node.js](https://nodejs.org) 22+.

```bash
npm install
npm start
```

| Command | What it does |
| --- | --- |
| `npm start` | Run the app from source |
| `npm test` / `npm run check` | Unit tests of the document core / syntax-check every script |
| `npm run smoke` | Start the app and run the self check: draws, drags, resizes, types, undoes and saves through the real UI code |
| `npm run pack` | Build `dist/Visual-win32-x64/Visual.exe` |
| `npm run icon` | Render `resources/icon.svg` (the wink) to `icon.png` and `icon.ico` |

## Using it

**V** move · **F** frame · **R** rectangle · **O** ellipse · **T** text · **Esc** back to move / select the parent.
Space + drag, the middle mouse button or scrolling pans; Ctrl + scroll zooms (5%–3200%). Shift keeps proportions while
resizing, Alt resizes from the centre, Alt + drag duplicates, Ctrl + click picks the deepest layer, double-click goes a
level deeper. Number fields take sums: `200 + 32`, or `/2` on the current value; drag a field's label to scrub it.
Layers snap to the edges and centres of the layers around them while you drag, resize or draw (hold Ctrl to place
freely), with the distances shown; hold Alt and point at a layer to measure. Ctrl+G groups, Ctrl+Alt+G puts a frame
around the selection, Ctrl+Shift+G ungroups; Alt+A/D/W/S/H/V align. A layer can have several fills (solid, linear or
radial gradient), strokes (inside, centre, outside) and effects (drop and inner shadow, layer and background blur).
Export settings live on the layer (PNG, JPEG, WebP at 0.5×–4×, SVG); right-click → *Copy as PNG / SVG* for the clipboard.
Shift+A gives a frame auto layout (or wraps the selection in one): a row or column with gap, padding and alignment,
where frames can hug their content and layers can fill the room left; drag a layer inside it to reorder, arrow keys
move it earlier or later. Children of other frames follow their constraints (left, right, both, centre, scale) when
the frame is resized. Drop images or SVG files on the canvas, paste them, or use Ctrl+Shift+K: images become image
fills (fill, fit, stretch, tile), SVGs become editable layers. Layers copied in one window paste into another.
A few seconds after each change the design is also written to a recovery folder; after a crash the start screen offers
it back. Ctrl+Alt+K turns a frame (or the selection) into a component; duplicating it, pasting it or dragging it from
the *Assets* tab (Alt+2) makes instances, which follow every change to the component. Restyle anything inside an
instance (text, colours, visibility, effects…) and that change is kept as an override while the rest keeps following;
*Reset* drops the overrides, *Detach* (Ctrl+Alt+B) turns the instance into an ordinary frame, and the instance menu swaps
it for another component. Components can hold instances of other components. Colour variables live in the Assets tab
(or save one from the colour picker with +): fills, strokes and shadows bound to one change with it. All shortcuts: *menu → Keyboard shortcuts* (Ctrl + /).

## How it's built

Electron for the window, files and dialogs ([main.mjs](main.mjs)); the editor is plain ES modules without a build step,
like Motion Studio:

- [src/core](src/core): the document (pages, node tree, ids), undo history, geometry, text layout, paints and colour
  conversion, snapping and alignment, auto layout and constraints, components, instances and colour variables, SVG path
  maths, SVG export and the sums in number fields. No DOM, so it's tested with `node --test`.
- [src/render](src/render): draws the page on a `<canvas>` (not DOM elements), so large designs stay fast; PNG/JPEG/WebP
  export uses the same drawing code, so exports look exactly like the canvas.
- [src/editor](src/editor): editor state and every action (all changes go through the undo history), mouse handling
  on the canvas, text editing.
- [src/ui](src/ui): start screen, layers and pages, assets, properties, menus, icons, translations (English and Dutch).

A `.visual` file is JSON: `{ format: "visual", version: 4, name, pages: [{ id, name, children: [...] }], assets, variables }`
(older files are upgraded when opened). Images are stored once in `assets`, keyed by a hash of their bytes. A component
is a frame with `component: true`; an instance is a frame with `instanceOf` and `overrides`, and holds a full copy of
the component's layers, each with `ref` (the layer it copies) and a fixed id `<instance id>;<ref>`, so a program that
reads the file (like Motion Studio) needs no component logic. Colours bound to a variable carry `variable` and their
current colour. Positions
are relative to the parent frame. Saving writes a temporary file first and swaps it in, so a crash never leaves half a
design behind.
