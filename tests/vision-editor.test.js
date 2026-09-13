const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadEditor } = require("./helpers/editor-harness.cjs");
const VisionEngine = require("../vision-engine.js");

function loadVisionEditor() {
  const editor = loadEditor();
  editor.context.window.VisionEngine = VisionEngine;
  editor.context.window.VISION_TERRAIN = {
    width: 20, height: 20, flags: Array(400).fill(0), mapUnits: 15000
  };
  editor.run(`
    state = { version: 1, vision: { perspective: "blue" }, paths: [], items: [
      createItem("champion", "blue", 50, 50, { id: "ally", label: "Blue observer", range: 0 }),
      createItem("champion", "red", 56, 50, { id: "near", label: "Visible enemy", range: 0 }),
      createItem("champion", "red", 80, 80, { id: "far", label: "Hidden enemy", range: 0 })
    ] };
    refreshVision();
  `);
  return editor;
}

function exportSnapshot(editor) {
  return editor.run(`window.DiagramExport.createSnapshot({
    state, filters, vision: visionResult, diagramWidth: 800,
    showSight: false, showRanges: true, showLabels: false,
    filename: "team-view.png", assetFor, isItemVisible
  })`);
}

function canvasRecorder(size = 1600) {
  const rings = [];
  const context = {
    globalAlpha: 1, drawImage() {}, fillRect() {}, beginPath() {}, stroke() {},
    arc(x, y, radius) { rings.push({ x, y, radius, lineWidth: this.lineWidth }); }
  };
  return { rings, options: {
    size, createCanvas: () => ({ getContext: () => context }), loadImage: async src => src
  } };
}

test("layer filters hide allied tokens without removing the sight they grant", () => {
  const editor = loadVisionEditor();
  assert.deepEqual(editor.result("visionResult.visibleIds"), ["ally", "near"]);
  const originalFog = editor.result("visionResult.fogRects");
  editor.run("setLayerFilter('blue', false); refreshVision();");
  assert.equal(editor.run("isItemVisible(state.items[0])"), false);
  assert.equal(editor.run("isItemVisible(state.items[1])"), true);
  assert.deepEqual(editor.result("visionResult.visibleIds"), ["ally", "near"]);
  assert.deepEqual(editor.result("visionResult.fogRects"), originalFog);
  assert.equal(editor.run("visionResult.sourceCount"), 1);
  assert.deepEqual(Array.from(exportSnapshot(editor).items, item => item.id), ["near"],
    "the export applies layer filters while retaining vision from the filtered ally");
});

test("hiding or disabling a source removes its sight and restoring it refreshes cached vision", () => {
  for (const field of ["hidden", "visionDisabled"]) {
    const editor = loadVisionEditor();
    assert.equal(editor.run("isItemVisible(state.items[1])"), true);
    editor.run(`state.items[0].${field} = true; refreshVision();`);
    assert.equal(editor.run("visionResult.sourceCount"), 0, field);
    assert.equal(editor.run("isItemVisible(state.items[1])"), false, field);
    assert.equal(editor.run("isItemVisible(state.items[2])"), false, field);
    assert.deepEqual(Array.from(exportSnapshot(editor).items, item => item.id), field === "hidden" ? [] : ["ally"]);
    editor.run(`state.items[0].${field} = false; refreshVision();`);
    assert.equal(editor.run("visionResult.sourceCount"), 1, field);
    assert.equal(editor.run("isItemVisible(state.items[1])"), true, "changing a source flag invalidates cached visibility");
  }
});

test("selection, restored history and PNG contents consistently exclude enemies in fog", async () => {
  const editor = loadVisionEditor();
  editor.run("selectItemsInBox({x:0,y:0},{x:100,y:100});");
  assert.deepEqual(editor.result("[...selectedIds]"), ["ally", "near"]);
  const blueState = editor.result("state");
  editor.context.reviewState = blueState;
  editor.run(`
    state.vision.perspective = "all"; refreshVision();
    restoreEditor({ state: reviewState, title: "Restored blue view", selection: {
      selectedId: "far", selectedIds: ["ally", "near", "far"]
    } });
  `);
  assert.equal(editor.run("visionResult.perspective"), "blue");
  assert.deepEqual(editor.result("[...selectedIds]"), ["ally", "near"],
    "history recalculates the restored perspective before restoring selection");
  assert.equal(editor.run("selectedId"), "near");
  editor.run("renderLayers();");
  assert.deepEqual(Array.from(editor.document.querySelector("#layer-list").children, row => row.dataset.id).sort(), ["ally", "near"]);
  const snapshot = exportSnapshot(editor);
  assert.deepEqual(Array.from(snapshot.items, item => item.id), ["ally", "near"]);
  assert.equal(snapshot.vision.radiusById.ally, 1350);
  const record = canvasRecorder();
  await editor.context.window.DiagramExport.renderToCanvas(snapshot, record.options);
  assert.equal(record.rings.length, 2, "no hidden enemy radius reveals its position in the PNG");
  for (const ring of record.rings) {
    assert.ok(Math.abs((2 * ring.radius + ring.lineWidth) / 1600 - 2 * 1350 / 15000) < 1e-10);
  }
});

test("a zero game-unit override removes sight and suppresses the old pixel range in PNGs", async () => {
  const editor = loadVisionEditor();
  editor.run("state.items[0].range = 190; state.items[0].visionRadius = 0; refreshVision();");
  assert.equal(editor.run("visionResult.sourceCount"), 0);
  assert.equal(editor.run("visionResult.radiusById.ally"), 0);
  assert.deepEqual(editor.result("visionResult.visibleIds"), ["ally"]);
  const snapshot = exportSnapshot(editor);
  assert.deepEqual(Array.from(snapshot.items, item => item.id), ["ally"]);
  const record = canvasRecorder();
  await editor.context.window.DiagramExport.renderToCanvas(snapshot, record.options);
  assert.equal(record.rings.length, 0, "explicit zero vision cannot fall back to a legacy pixel ring");
  editor.run("delete state.items[0].visionRadius; refreshVision();");
  assert.equal(editor.run("visionResult.radiusById.ally"), 1350);
  assert.equal(editor.run("isItemVisible(state.items[1])"), true);
});
