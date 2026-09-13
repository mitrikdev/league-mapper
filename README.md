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

## Team vision and fog of war

Use **View → Blue team / Red team** above the map or in Present. The perspective applies across all steps, saves with the play, and supports undo. **All vision** returns to the full editing view. **New → Vision walkthrough** demonstrates an enemy hidden by river brush, revealed by an allied ward, then hidden again when an enemy control ward suppresses it.

The model combines active allied sources and clips ordinary sight against the actual wall, brush, transparent-wall and base-gate grid. Enemies outside sight are omitted from the canvas, selection, layers and PNG. Known structures and coach annotations remain visible. Layer filters are display-only; hiding an individual unit or enabling **Vision disabled / inactive** removes its sight.

Select a ward to choose **Stealth**, **Control**, or **Farsight**. Control wards reveal and suppress opposing stealth/farsight wards when their detection reaches them; the suppressing control ward is revealed to the affected team. Farsight uses an unobstructed radius. Sight-radius guides use game units and are hidden by default; they show maximum distance, while the fog shows terrain-limited coverage. A source placed in blocking terrain reports the problem in its details. A radius override is a simple custom source, not a complete ability simulation. The legacy Dim token option only changes appearance.

| Source | Ordinary sight radius |
| --- | ---: |
| Champion / clone | 1350 |
| Minion / cannon minion | 1200 |
| Super minion / turret | 1350 |
| Stealth / control ward | 900 |
| Farsight ward | 500 |

Turret detection uses a separate 1100-unit radius. Neutral units never grant team sight. Ward and minion radii come from Riot character data mirrored by [CommunityDragon](https://raw.communitydragon.org/latest/game/data/characters/yellowtrinket/yellowtrinket.bin.json); 1350 is the standard ordinary engine-default assumption. Farsight changes are described in [Riot patch 13.10](https://www.leagueoflegends.com/en-gb/news/game-updates/patch-13-10-notes/) and turret detection in [26.1](https://www.leagueoflegends.com/en-sg/news/game-updates/patch-26-1-notes/).

### Accuracy and terrain provenance

This is a **static planning model for the 2024 base Rift**, not a replica of the current server. The existing map artwork is byte-identical to the matching render in [FrankTheBoxMonster's NGRID data](https://github.com/FrankTheBoxMonster/LoL-NGRID-converter/tree/92943ed2b2d5e82c86d680e69f53f247c89aefee/SR_2024). Its 295 × 296 grid retains the original 50-unit cell flags. Artwork registration is measured (estimated 10 game units of alignment error), and fog edges are rasterized at cell resolution; token visibility uses exact distance and cell traversal.

Brush uses connected regions and per-source line of sight, combined into team visibility. An outside source does not independently see through brush merely because a different ally reveals part of it. This conservative shared-brush interaction has not been validated against live-game behavior.

Not simulated: later map/elemental changes, Faelights, champion camouflage/invisibility and ability vision, sweepers, ward lifetimes, Farsight trigger bursts/self-destruction, attack reveals, and visibility timing or memory. Faelight regions themselves changed in [26.3](https://www.leagueoflegends.com/en-gb/news/game-updates/patch-26-3-notes/), so the base-map model must not be treated as current-patch parity.

Rebuild the bundled terrain data with `node tools/generate-vision-terrain.cjs`. The generator fetches a pinned game-data file, validates its SHA-256, and produces the browser/CommonJS asset. Source hashes, bounds, flags and limitations are embedded in `assets/vision-terrain.js`; the runtime makes no network requests for terrain.

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
- `vision-engine.js`: terrain-aware sight, shared team fog, ward detection and suppression.
- `assets/vision-terrain.js`: pinned 2024 base map flags, coordinate calibration and source metadata.
- `styles.css`: responsive workspace, map tools, sequence strip, and presentation layout.
- `assets/game-start-state.js`: full Rift starting arrangement.
- `assets/export-assets.js`: embedded assets for PNG export when opening from disk.

Classic scripts preserve direct file opening. Keep the data/history/export modules before `app.js`; load `playbook-ui.js` after it.

## Verification

With Node.js 18 or newer installed:

```sh
node --test
```

Tests use the built-in runner without dependencies. They cover imports, safe labels, scene isolation, whole-playbook history, focused-field draft recovery, playback, presentation guards, selection, and export geometry. Vision tests also cover wall/brush/gate behavior, team sharing, ward detection, fog-aware selection and PNGs, range overrides, and real-terrain examples. Browser checks remain necessary for layout and physical pointer interactions.

The editor uses `assets/sr.webp`, retaining the original map resolution with a smaller download. `assets/sr.png` remains the source. To rebuild the compressed asset, install Pillow and run `python tools/build-map-asset.py`.
