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
    filter: "none",
    fillRect(x, y, width, height) { calls.push({ type: "rect", x, y, width, height, color: this.fillStyle, alpha: this.globalAlpha }); },
    beginPath() {},
    closePath() { calls.push({ type: "closePath" }); },
    fill() { calls.push({ type: "fill", color: this.fillStyle, alpha: this.globalAlpha }); },
    moveTo(x, y) { calls.push({ type: "moveTo", x, y }); },
    lineTo(x, y) { calls.push({ type: "lineTo", x, y }); },
    arc(x, y, radius) { calls.push({ type: "arc", x, y, radius, lineWidth: this.lineWidth, alpha: this.globalAlpha }); },
    stroke() { calls.push({ type: "stroke", lineWidth: this.lineWidth, alpha: this.globalAlpha, color: this.strokeStyle, filter: this.filter }); },
    drawImage(image, x, y, width, height) { calls.push({ type: "image", image, x, y, width, height, alpha: this.globalAlpha, filter: this.filter }); },
    measureText(text) { return { width: Array.from(text).length * parseFloat(this.font.split(" ")[1]) * 0.6 }; },
    strokeText() {},
    fillText(text, x, y) { calls.push({ type: "text", text, x, y, font: this.font, color: this.fillStyle, align: this.textAlign, baseline: this.textBaseline, alpha: this.globalAlpha }); }
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
    assert.equal(parseFloat(label.font.split(" ")[1]), 10 * cssScale);
    assert.equal(label.font.split(" ")[0], "600");
    assert.equal(label.y, 800 + (16 / 2 + 3) * cssScale);
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

test("directional PNG arrows match the SVG marker geometry and ignore repeated endpoints", async () => {
  for (const width of [1, 4, 7]) {
    const snapshot = makeSnapshot({
      state: { items: [], paths: [{ arrow: true, color: "#42d6a4", width,
        points: [{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 20 }] }] }
    });
    const record = canvasRecorder();
    await DiagramExport.renderToCanvas(snapshot, { ...record.options, size: 1200 });
    const scale = Math.max(10, width * 3) * 1.2 / 12;
    const vertices = record.calls.filter((call) => call.type === "moveTo" || call.type === "lineTo").slice(-3);
    const expected = [[360 - 9 * scale, 240 - 5 * scale], [360 + scale, 240], [360 - 9 * scale, 240 + 5 * scale]];
    vertices.forEach((vertex, index) => {
      assert.ok(Math.abs(vertex.x - expected[index][0]) < 1e-10);
      assert.ok(Math.abs(vertex.y - expected[index][1]) < 1e-10);
    });
    assert.deepEqual(record.calls.find((call) => call.type === "fill"), { type: "fill", color: "#42d6a4", alpha: 1 });
    assert.equal(record.calls.filter((call) => call.type === "closePath").length, 1);
  }
});

test("vertical arrowheads follow their final segment and legacy or zero-length paths draw no head", async () => {
  const vertical = makeSnapshot({
    state: { items: [], paths: [{ arrow: true, width: 4,
      points: [{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 40 }] }] }
  });
  const verticalRecord = canvasRecorder();
  await DiagramExport.renderToCanvas(vertical, { ...verticalRecord.options, size: 1000 });
  const tip = verticalRecord.calls.filter((call) => call.type === "lineTo").at(-2);
  assert.ok(Math.abs(tip.x - 300) < 1e-10);
  assert.ok(Math.abs(tip.y - 401) < 1e-10);

  for (const path of [
    { arrow: true, points: [] },
    { arrow: true, points: [{ x: 20, y: 20 }] },
    { arrow: true, points: [{ x: 20, y: 20 }, { x: 20, y: 20 }] },
    { arrow: false, points: [{ x: 0, y: 0 }, { x: 20, y: 20 }] },
    { points: [{ x: 0, y: 0 }, { x: 20, y: 20 }] }
  ]) {
    const record = canvasRecorder();
    await DiagramExport.renderToCanvas(makeSnapshot({ state: { items: [], paths: [path] } }), record.options);
    assert.equal(record.calls.some((call) => call.type === "fill" || call.type === "closePath"), false);
    for (const call of record.calls) {
      if (call.x !== undefined) assert.equal(Number.isFinite(call.x), true);
      if (call.y !== undefined) assert.equal(Number.isFinite(call.y), true);
    }
  }
});

test("role badges export as team-colored circles with centered identities and no duplicate labels", async () => {
  for (const [team, color] of [["blue", "#1976cf"], ["red", "#cc3853"], ["neutral", "#806729"]]) {
    const snapshot = makeSnapshot({ state: { items: [{
      id: "role", type: "champion", team, role: "JGL", label: "JGL",
      x: 25, y: 50, size: 7, range: 0, opacity: 60, cloaked: true
    }], paths: [] } });
    const record = canvasRecorder();
    await DiagramExport.renderToCanvas(snapshot, record.options);
    const badge = record.calls.find((call) => call.type === "arc");
    assert.equal(badge.x, 400);
    assert.equal(badge.y, 800);
    assert.equal(badge.radius * 2 + badge.lineWidth, 28 * 2.5);
    assert.equal(record.calls.find((call) => call.type === "fill").color, color);
    assert.equal(record.calls.filter((call) => call.type === "image").length, 1, "role badge needs no token image asset");
    const labels = record.calls.filter((call) => call.type === "text");
    assert.equal(labels.length, 1);
    assert.equal(labels[0].text, "JGL");
    assert.equal(labels[0].color, "#ffffff");
    assert.equal(labels[0].align, "center");
    assert.equal(labels[0].baseline, "middle");
    assert.equal(labels[0].x, 400);
    assert.equal(labels[0].y, 800);
    assert.ok(Math.abs(parseFloat(labels[0].font.split(" ")[1]) - 28 * 0.34 * 2.5) < 1e-10);
    assert.equal(labels[0].alpha, 0.24);
  }
});

test("custom role labels respect label visibility while the role identity remains visible", async () => {
  const snapshot = makeSnapshot({ state: { items: [{
    id: "role", type: "champion", team: "blue", role: "MID", label: "Engage here",
    x: 25, y: 50, size: 7, range: 0, opacity: 100
  }], paths: [] } });
  const visible = canvasRecorder();
  await DiagramExport.renderToCanvas(snapshot, visible.options);
  const labels = visible.calls.filter((call) => call.type === "text");
  assert.deepEqual(labels.map((call) => call.text), ["MID", "Engage here"]);
  assert.equal(labels[1].baseline, "top");
  assert.equal(labels[1].y, 800 + (36 / 2 + 3) * 2.5);

  const hidden = canvasRecorder();
  await DiagramExport.renderToCanvas({ ...snapshot, showLabels: false }, hidden.options);
  assert.deepEqual(hidden.calls.filter((call) => call.type === "text").map((call) => call.text), ["MID"]);
});

function visionFixture(overrides = {}) {
  return {
    perspective: "blue",
    fogRects: [[0, 0, 100, 20], [10, 25, 20, 5]],
    visibleIds: ["ward"],
    radiusById: { ward: 1100 },
    mapUnits: 15000,
    ...overrides
  };
}

test("PNG team vision hides unseen enemies and still honors editor visibility filters", async () => {
  for (const perspective of ["blue", "red"]) {
    const snapshot = makeSnapshot({
      state: { items: [
        { id: "ally", type: "ward", team: perspective, x: 20, y: 30, size: 2, range: 190, opacity: 100, label: "Ally" },
        { id: "unseen", type: "champion", team: perspective === "blue" ? "red" : "blue", x: 80, y: 80, size: 7, range: 190, opacity: 100, label: "SECRET" },
        { id: "hidden", type: "ward", team: perspective, hidden: true, x: 30, y: 30, size: 2, range: 190, opacity: 100, label: "HIDDEN" }
      ], paths: [] },
      vision: visionFixture({ perspective, visibleIds: ["ally", "hidden"], radiusById: { ally: 1100, unseen: 1350, hidden: 1100 } })
    });
    assert.deepEqual(snapshot.items.map((item) => item.id), ["ally"]);
    const record = canvasRecorder();
    await DiagramExport.renderToCanvas(snapshot, record.options);
    assert.deepEqual(record.calls.filter((call) => call.type === "text").map((call) => call.text), ["Ally"]);
    assert.equal(record.calls.filter((call) => call.type === "arc").length, 1, "no enemy range reveals its position");
    assert.deepEqual(record.calls.filter((call) => call.type === "image").map((call) => call.image), ["assets/sr-export.jpg", "ward.png"]);
  }
});

test("fog, visible IDs and world ranges remain fixed while export images load", async () => {
  const vision = visionFixture();
  const snapshot = makeSnapshot({ vision, showSight: true });
  const expected = JSON.parse(JSON.stringify(snapshot.vision));
  const record = canvasRecorder();
  let resumeMap;
  const waiting = new Promise((resolve) => { resumeMap = resolve; });
  const rendering = DiagramExport.renderToCanvas(snapshot, {
    ...record.options,
    loadImage: async (src) => src === "assets/sr-export.jpg" ? waiting : src
  });
  vision.perspective = "all";
  vision.fogRects[0][2] = 1;
  vision.fogRects.push([90, 90, 10, 10]);
  vision.visibleIds.length = 0;
  vision.radiusById.ward = 0;
  vision.mapUnits = 1;
  resumeMap("assets/sr-export.jpg");
  await rendering;
  assert.deepEqual(snapshot.vision, expected);
  const rects = record.calls.filter((call) => call.type === "rect");
  assert.deepEqual(rects, [
    { type: "rect", x: 0, y: 0, width: 1600, height: 320, color: "rgba(7,13,22,.82)", alpha: 1 },
    { type: "rect", x: 160, y: 400, width: 320, height: 80, color: "rgba(7,13,22,.82)", alpha: 1 }
  ]);
  const fogIndex = record.calls.findIndex((call) => call.type === "rect");
  const sightIndex = record.calls.findIndex((call) => call.image === "assets/sr sight.jpeg");
  const pathIndex = record.calls.findIndex((call) => call.type === "moveTo");
  const tokenIndex = record.calls.findIndex((call) => call.image === "ward.png");
  assert.ok(sightIndex < fogIndex && fogIndex < pathIndex && pathIndex < tokenIndex);
  const ring = record.calls.find((call) => call.type === "arc");
  assert.ok(Math.abs(2 * ring.radius + ring.lineWidth - 2 * 1100 / 15000 * 1600) < 1e-10);
});

test("game-unit ranges keep the same map diameter at different editor and PNG sizes", async () => {
  for (const diagramWidth of [390, 640, 980]) {
    for (const size of [1000, 1600]) {
      const snapshot = makeSnapshot({ diagramWidth,
        state: { items: [{ id: "champion", type: "champion", team: "blue", x: 50, y: 50, size: 7, range: 0, opacity: 100, label: "Champion" }], paths: [] },
        vision: visionFixture({ perspective: "all", visibleIds: [], radiusById: { champion: 1350 } })
      });
      const record = canvasRecorder();
      await DiagramExport.renderToCanvas(snapshot, { ...record.options, size });
      const ring = record.calls.find((call) => call.type === "arc");
      assert.ok(ring, "champion vision renders despite a zero legacy range");
      assert.ok(Math.abs((2 * ring.radius + ring.lineWidth) / size - 2700 / 15000) < 1e-10);
      assert.equal(ring.lineWidth, 2 * size / diagramWidth);
      assert.equal(record.calls.some((call) => call.type === "fill"), false, "world-radius guides are border-only, matching the editor");
      assert.equal(record.calls.some((call) => call.type === "rect"), false, "all-map perspective does not draw fog");
    }
  }
});

test("zero world vision suppresses legacy ranges and the range toggle suppresses all rings", async () => {
  for (const options of [
    { vision: visionFixture({ radiusById: { ward: 0 } }) },
    { vision: visionFixture(), showRanges: false }
  ]) {
    const record = canvasRecorder();
    await DiagramExport.renderToCanvas(makeSnapshot(options), record.options);
    assert.equal(record.calls.some((call) => call.type === "arc"), false);
  }
  const record = canvasRecorder();
  await DiagramExport.renderToCanvas(makeSnapshot({ vision: visionFixture({ radiusById: {} }) }), record.options);
  const legacy = record.calls.find((call) => call.type === "arc");
  assert.equal(2 * legacy.radius + legacy.lineWidth, 190 * 1600 / 640);
});

test("ward variants keep their outlines and disabled appearance in the PNG", async () => {
  for (const diagramWidth of [390, 640, 980]) {
    for (const [wardKind, color] of [["control", "#ec6c97"], ["farsight", "#81d5ec"]]) {
      for (const disabled of ["none", "manual", "control"]) {
        const snapshot = makeSnapshot({ diagramWidth, showRanges: false,
          state: { items: [{ id: "ward", type: "ward", team: "blue", wardKind,
            x: 25, y: 50, size: 3, range: 0, opacity: 100, label: "Ward",
            visionDisabled: disabled === "manual"
          }], paths: [] },
          vision: visionFixture({ disabledWardIds: disabled === "control" ? ["ward"] : [] })
        });
        const record = canvasRecorder();
        await DiagramExport.renderToCanvas(snapshot, record.options);
        const cssScale = 1600 / diagramWidth;
        const outline = record.calls.find((call) => call.type === "arc");
        assert.equal(outline.lineWidth, 2 * cssScale);
        assert.ok(Math.abs(outline.radius - (12 / 2 + 1 + 2 / 2) * cssScale) < 1e-10,
          "outline sits outside the icon with a 1px gap and 2px border");
        const expectedFilter = disabled === "none" ? "none" : "grayscale(1)";
        const stroke = record.calls.find((call) => call.type === "stroke");
        assert.equal(stroke.color, color);
        assert.equal(stroke.filter, expectedFilter);
        const image = record.calls.find((call) => call.type === "image" && call.image === "ward.png");
        assert.equal(image.filter, expectedFilter);
        assert.equal(record.context.filter, "none", "grayscale cannot carry into labels or later tokens");
      }
    }
  }
});

test("suppressed stealth wards are gray without adding a ward-variant outline", async () => {
  const snapshot = makeSnapshot({ showRanges: false,
    vision: visionFixture({ disabledWardIds: ["ward"] })
  });
  const record = canvasRecorder();
  await DiagramExport.renderToCanvas(snapshot, record.options);
  assert.equal(record.calls.find((call) => call.image === "ward.png").filter, "grayscale(1)");
  assert.equal(record.calls.some((call) => call.type === "arc"), false);
});
