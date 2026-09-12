# Rift Diagram Studio

A local League of Legends diagram editor. Open `index.html` in a browser; no build step or account is required. It can also be served as a static website.

## Editing

- Add tokens from the palette, then drag them on the map.
- Drag on empty space to select visible, unlocked tokens; hold Shift to extend the selection.
- Use S, D, and E to select, draw, and erase. Escape returns to selection.
- Undo with Ctrl/Cmd+Z; redo with Ctrl/Cmd+Shift+Z.
- Save a diagram with the Save button or Ctrl/Cmd+S. Files are downloaded to your browser's download location; unsaved work does not persist after closing or refreshing the page.
- Load a saved diagram through Load Rift Diagram. Invalid files leave your current work intact. A successful load can be undone.
- Export PNG saves the full map with the current visible layers, labels, sight overlay, and vision ranges. Camera zoom/pan are not cropped into the export.

## Code layout

- `app.js`: editor controls, selection, pointer interactions, and DOM rendering.
- `diagram-data.js`: diagram validation and normalization.
- `diagram-history.js`: snapshots and undo/redo.
- `diagram-export.js`: export snapshots, coordinate scaling, and PNG generation.
- `styles.css`: responsive layout and editor styling.
- `assets/game-start-state.js`: initial token arrangement.
- `assets/export-assets.js`: embedded images for PNG export when opening the app directly from disk.

These use classic browser scripts so direct file opening remains supported. Keep the data, history, and export modules before `app.js` in `index.html`.

## Tests

With Node.js 18 or newer installed, run:

```sh
node --test
```

The tests use Node's built-in runner and require no dependencies. They cover valid and invalid imports, safe labels, history, visibility-aware selection, and export proportions. Browser checks are also needed when changing layout or pointer interactions.

The source map `assets/sr.png` is retained for future asset builds. The editor loads the compressed `assets/sr.webp` at the same resolution for zoom detail.
