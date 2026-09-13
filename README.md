# Rift / Playbook

A tactical workspace for explaining League of Legends scenarios, reviewing decisions, and walking a team through a play. Open `index.html` directly in a modern browser, or serve the folder as a static website. No build step or account is required.

## Build a play

1. Start with the editable **Dragon river control** example, a blank map, or the full Rift setup from **New**.
2. Use the blue/red roster to add or select TOP, JGL, MID, BOT, and SUP. Drag the role badges into position. Ward, minion, champion, and marker shortcuts are nearby; more objects are in the palette.
3. Choose **Arrow** to show movement, or draw freehand. Colors distinguish control, danger, and safe movement. Erase individual annotations or clear all routes in the current step.
4. Give the step a title and a coaching note. Click **Next step** to carry the current positions forward, then adjust the new step. Each step owns its positions and annotations.
5. Use the sequence strip to navigate, duplicate, reorder, or delete steps. Undo/redo restores the complete play, including deleted steps and notes.
6. Choose **Present** for an uncluttered map and coaching note. Use the arrow keys to walk through the steps, or Space to play them automatically. Escape returns to editing.

## Saving and sharing

- The current play is saved as a **local draft on this device**. In-progress text is included. There is no account sync or simultaneous editing.
- **Save play** downloads a JSON playbook containing every step and note. Send that file to a teammate; **Load** opens it.
- Older single-diagram JSON files still open as one-step plays. Invalid files leave current work intact; a successful import can be undone.
- **Export PNG** renders the current step with the visible pieces, arrows, vision ranges, and labels. It exports the full map, independently of camera zoom or pan.
- If browser storage is unavailable or full, the interface asks you to download a copy. A malformed stored draft is preserved until you explicitly start a new play or load a file.

## Controls

| Key / action | Behavior |
| --- | --- |
| S | Select and move |
| A | Draw a directional arrow |
| D | Draw freehand |
| E | Erase a piece or route |
| H | Pan the map |
| P | Place a marker |
| Drag empty map | Box-select visible, unlocked pieces |
| Shift + select | Extend selection |
| Arrow keys with selected pieces | Nudge positions; Shift makes a larger move |
| Scroll / wheel | Zoom around the cursor |
| Ctrl/Cmd + Z | Undo |
| Ctrl/Cmd + Shift + Z | Redo |
| Ctrl/Cmd + D | Duplicate selected pieces |
| Ctrl/Cmd + S | Download the playbook |
| F | Enter presentation mode |
| Left / Right in Present | Previous / next step |
| Space in Present | Play / pause the steps |
| Escape | Exit Present or return to selection |
| ? | Open controls and shortcuts |

Playback stops when you begin editing. Presentation mode allows navigation and panning while guarding against accidental edits.

## Code layout

- `app.js`: map rendering, selection, drawing, pointer and keyboard interactions.
- `playbook-ui.js`: scenario workflow, roster controls, presentation, and local draft persistence.
- `playbook-data.js`: version-2 playbooks, scene validation, duplication and ordering; legacy diagram migration.
- `diagram-data.js`: individual diagram validation, including role badges and directional paths.
- `diagram-history.js`: editor and full-playbook snapshots for undo/redo.
- `diagram-export.js`: immutable export snapshots and PNG rendering.
- `styles.css`: responsive workspace, map tools, sequence strip, and presentation layout.
- `assets/game-start-state.js`: full Rift starting arrangement.
- `assets/export-assets.js`: embedded assets for PNG export when opening from disk.

Classic scripts preserve direct file opening. Keep the data/history/export modules before `app.js`; load `playbook-ui.js` after it.

## Verification

With Node.js 18 or newer installed:

```sh
node --test
```

Tests use the built-in runner without dependencies. They cover imports, safe labels, scene isolation, whole-playbook history, focused-field draft recovery, playback, presentation guards, selection, and export geometry. Browser checks remain necessary for layout and physical pointer interactions.

The editor uses `assets/sr.webp`, retaining the original map resolution with a smaller download. `assets/sr.png` remains the source. To rebuild the compressed asset, install Pillow and run `python tools/build-map-asset.py`.
