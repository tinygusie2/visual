# Visual

A local-first desktop design editor for UI mockups, posters and social visuals: open it, get a canvas, draw a frame,
build something, save it and export it. Its companion is [Motion Studio](https://github.com/tinygusie2/motion-studio):
Visual designs, Motion Studio animates, and designs go across **layer by layer** instead of as a flat screenshot.
That is why every layer has an id that never changes (`node_3fa92c01b7de`).

## Status: step 1 of 5

| Step | What | |
| --- | --- | --- |
| 1 | Start screen, `.visual` files, infinite canvas, frames, rectangle, ellipse, text, layers, pages, select / move / resize, undo | ✅ |
| 2 | Snapping with distances, alignment, groups, gradients, strokes, shadows and blur, PNG/SVG export, colour picker | |
| 3 | Auto layout, constraints, images, SVG import, autosave and recovery | |
| 4 | Components, instances and overrides, colour variables, assets panel | |
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
All shortcuts: *menu → Keyboard shortcuts* (Ctrl + /).

## How it's built

Electron for the window, files and dialogs ([main.mjs](main.mjs)); the editor is plain ES modules without a build step,
like Motion Studio:

- [src/core](src/core): the document (pages, node tree, ids), undo history, geometry, text layout and the sums in
  number fields. No DOM, so it's tested with `node --test`.
- [src/render](src/render): draws the page on a `<canvas>` (not DOM elements), so large designs stay fast.
- [src/editor](src/editor): editor state and every action (all changes go through the undo history), mouse handling
  on the canvas, text editing.
- [src/ui](src/ui): start screen, layers and pages, properties, menus, icons, translations (English and Dutch).

A `.visual` file is JSON: `{ format: "visual", version: 1, name, pages: [{ id, name, children: [...] }] }`. Positions
are relative to the parent frame. Saving writes a temporary file first and swaps it in, so a crash never leaves half a
design behind.
