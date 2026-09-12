const test = require("node:test");
const assert = require("node:assert/strict");
const DiagramExport = require("../diagram-export.js");

function makeSnapshot(overrides = {}) {
  return DiagramExport.createSnapshot({
    state: {
      items: [{ id: "ward", type: "ward", team: "blue", x: 25, y: 50, size: 2, range: 190, opacity: 100, label: "Ward" }],
      paths: [{ points: [{ x: 10, y: 20 }, { x: 30, y: 40 }], width: 7 }]
    },
    filters: { drawings: true },
    diagramWidth: 640,
    showSight: false,
    showRanges: true,
    showLabels: true,
    filename: "diagram.png",
    assetFor: (item) => `${item.type}.png`,
    isItemVisible: (item, filters) => !item.hidden && filters[item.team] !== false,
    ...overrides
  });
}

function canvasRecorder() {
  const calls = [];
  const context = {
    globalAlpha: 1,
    beginPath() {},
    moveTo(x, y) { calls.push({ type: "moveTo", x, y }); },
    lineTo(x, y) { calls.push({ type: "lineTo", x, y }); },
    arc(x, y, radius) { calls.push({ type: "arc", x, y, radius, lineWidth: this.lineWidth, alpha: this.globalAlpha }); },
    stroke() { calls.push({ type: "stroke", lineWidth: this.lineWidth, alpha: this.globalAlpha }); },
    drawImage(image, x, y, width, height) { calls.push({ type: "image", image, x, y, width, height, alpha: this.globalAlpha }); },
    measureText(text) { return { width: Array.from(text).length * parseFloat(this.font.split(" ")[1]) * 0.6 }; },
    strokeText() {},
    fillText(text, x, y) { calls.push({ type: "text", text, x, y, font: this.font, alpha: this.globalAlpha }); }
  };
  const canvas = { getContext: () => context, toBlob: (callback) => callback({ type: "image/png" }) };
  return { calls, canvas, context, options: { createCanvas: () => canvas, loadImage: async (src) => src } };
}

for (const diagramWidth of [640, 980]) {
  test(`PNG preserves CSS proportions at a ${diagramWidth}px diagram width`, async () => {
    const record = canvasRecorder();
    await DiagramExport.renderToCanvas(makeSnapshot({ diagramWidth }), record.options);
    const cssScale = 1600 / diagramWidth;
    const icon = record.calls.find((call) => call.type === "image" && call.image === "ward.png");
    const ring = record.calls.find((call) => call.type === "arc");
    const label = record.calls.find((call) => call.type === "text");
    assert.equal(icon.width, 8 * cssScale);
    assert.equal(icon.height, icon.width);
    assert.equal(icon.x + icon.width / 2, 400);
    assert.equal(icon.y + icon.height / 2, 800);
    assert.equal(ring.x, 400);
    assert.equal(ring.y, 800);
    assert.ok(Math.abs((2 * ring.radius + ring.lineWidth) / icon.width - 190 / 8) < 1e-10);
    assert.equal(parseFloat(label.font.split(" ")[1]), 12 * cssScale);
    assert.equal(label.y, 800 + (16 / 2 + 5) * cssScale);
    assert.ok(Math.abs(record.calls.find((call) => call.type === "stroke").lineWidth - 11.2) < 1e-10);
    assert.deepEqual(record.calls.find((call) => call.type === "moveTo"), { type: "moveTo", x: 160, y: 320 });
  });
}

test("export uses one state, filter, and asset snapshot even while image loading is pending", async () => {
  const state = {
    items: [
      { id: "blue", type: "ward", team: "blue", x: 25, y: 50, size: 2, range: 190, opacity: 50, cloaked: true, label: "Original" },
      { id: "red", type: "ward", team: "red", x: 0, y: 0, size: 2, range: 0, opacity: 100, label: "Filtered" }
    ],
    paths: [{ points: [{ x: 10, y: 20 }, { x: 30, y: 40 }], width: 7 }]
  };
  const filters = { blue: true, red: false, drawings: true };
  const snapshot = makeSnapshot({ state, filters });
  const record = canvasRecorder();
  let resumeMap;
  const mapLoaded = new Promise((resolve) => { resumeMap = resolve; });
  const rendering = DiagramExport.renderToCanvas(snapshot, {
    ...record.options,
    loadImage: async (src) => src === "assets/sr-export.jpg" ? mapLoaded : src
  });

  state.items[0].x = 80;
  state.items[0].label = "Changed";
  state.items[0].type = "champion";
  state.paths[0].points[0].x = 90;
  filters.red = true;
  filters.drawings = false;
  resumeMap("assets/sr-export.jpg");
  await rendering;

  const images = record.calls.filter((call) => call.type === "image");
  assert.equal(images.length, 2, "only the map and originally visible token should render");
  assert.equal(images[1].image, "ward.png");
  assert.equal(images[1].x + images[1].width / 2, 400);
  assert.equal(images[1].alpha, 0.2);
  assert.equal(record.calls.find((call) => call.type === "text").text, "Original");
  assert.equal(record.calls.find((call) => call.type === "text").alpha, 0.2);
  assert.equal(record.calls.find((call) => call.type === "arc").alpha, 0.2);
  assert.equal(record.calls.find((call) => call.type === "moveTo").x, 160);
  assert.equal(snapshot.filename, "diagram.png");
});

test("view toggles omit drawings, ranges and labels while retaining the sight overlay", async () => {
  const record = canvasRecorder();
  await DiagramExport.renderToCanvas(makeSnapshot({
    filters: { drawings: false }, showSight: true, showRanges: false, showLabels: false
  }), record.options);
  assert.equal(record.calls.some((call) => ["arc", "stroke", "text"].includes(call.type)), false);
  const sight = record.calls.find((call) => call.type === "image" && call.image === "assets/sr sight.jpeg");
  assert.equal(sight.alpha, 0.88);
});

test("long labels are ellipsized to the editor's maximum label width", async () => {
  const snapshot = makeSnapshot();
  snapshot.items[0].label = "This label is much too long to fit".repeat(1000);
  const record = canvasRecorder();
  await DiagramExport.renderToCanvas(snapshot, record.options);
  const text = record.calls.find((call) => call.type === "text").text;
  assert.ok(text.endsWith("…"));
  assert.ok(record.context.measureText(text).width <= 110 * 1600 / 640);
});

test("embedded assets remain available for file-based exports, with URL fallback", () => {
  const previous = global.EXPORT_ASSETS;
  try {
    global.EXPORT_ASSETS = { "ward.png": "data:image/png;base64,embedded" };
    assert.equal(DiagramExport.assetUrl("ward.png"), "data:image/png;base64,embedded");
    assert.equal(DiagramExport.assetUrl("other.png"), "other.png");
  } finally {
    if (previous === undefined) delete global.EXPORT_ASSETS;
    else global.EXPORT_ASSETS = previous;
  }
});

test("a failed PNG encoding reports an error instead of offering an empty download", async () => {
  const record = canvasRecorder();
  record.canvas.toBlob = (callback) => callback(null);
  await assert.rejects(DiagramExport.createPng(makeSnapshot(), record.options), /did not produce a PNG blob/);
});
