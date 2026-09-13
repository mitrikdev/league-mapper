const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const DiagramData = require("../diagram-data.js");

const appSource = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8").replace(/\r\n/g, "\n");
const defaultsSource = appSource.match(/const defaults = (\{[\s\S]*?\n\});/)[1];
const defaults = vm.runInNewContext(`(${defaultsSource})`);
const normalize = (value) => DiagramData.normalizeState(value, Object.keys(defaults));
const clone = (value) => JSON.parse(JSON.stringify(value));

function fixture(overrides = {}) {
  return {
    version: 1,
    items: [{
      id: "item-1", type: "ward", team: "blue", x: 42, y: 73,
      size: 2, range: 190, opacity: 100, label: "Ward", ...overrides
    }],
    paths: [{ color: "#f0d66a", width: 4, points: [{ x: 0, y: 100 }, { x: 25.4, y: 50 }] }]
  };
}

function functionSource(name) {
  const start = appSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists in app.js`);
  const end = appSource.indexOf("\n}", start + 1) + 2;
  return appSource.slice(start, end);
}

test("Game Start and saved editor data validate without changing content", () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../assets/game-start-state.js"), "utf8"), context);
  const gameStart = clone(context.window.DEFAULT_START_STATE);
  assert.deepEqual(normalize(gameStart), gameStart);
  const saved = normalize(fixture({ label: "A long custom label ".repeat(20) }));
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(saved))), saved);
  assert.deepEqual(normalize({ version: 1, items: [], paths: [] }), { version: 1, items: [], paths: [] });
});

test("optional legacy flags and path settings receive defaults without sharing references", () => {
  const original = fixture();
  delete original.paths[0].color;
  delete original.paths[0].width;
  const normalized = normalize(original);
  assert.equal(normalized.items[0].hidden, false);
  assert.equal(normalized.items[0].locked, false);
  assert.equal(normalized.items[0].cloaked, false);
  assert.equal(normalized.items[0].groupId, null);
  assert.equal(normalized.paths[0].color, "#f0d66a");
  assert.equal(normalized.paths[0].width, 7);
  normalized.items[0].x = 4;
  normalized.paths[0].points[0].x = 4;
  assert.equal(original.items[0].x, 42);
  assert.equal(original.paths[0].points[0].x, 0);
});

test("unrelated JSON, unsupported versions and malformed collections are rejected", () => {
  for (const input of [null, [], "diagram", { hello: "world" }, { ...fixture(), version: 2 },
    { ...fixture(), version: "1" }, { version: 1, items: [] }, { ...fixture(), items: {} },
    { ...fixture(), paths: null }, { ...fixture(), items: [null] }, { ...fixture(), paths: [null] }]) {
    assert.throws(() => normalize(input));
  }
});

test("invalid IDs, types, teams, labels and booleans are rejected before import", () => {
  for (const overrides of [{ id: "" }, { id: 1 }, { id: "item\" onclick=alert(1)" },
    { type: "../remote" }, { type: "__proto__" }, { team: "purple" },
    { label: {} }, { label: null }, { hidden: "false" }, { locked: 1 },
    { cloaked: null }, { groupId: "" }, { groupId: {} }]) {
    assert.throws(() => normalize(fixture(overrides)), JSON.stringify(overrides));
  }
  const duplicate = fixture();
  duplicate.items.push(clone(duplicate.items[0]));
  assert.throws(() => normalize(duplicate), /unique/);
});

test("all coordinates and dimensions must be finite numbers inside the editor's supported bounds", () => {
  const bounds = { x: [0, 100], y: [0, 100], size: [1, 8], range: [0, 220], opacity: [0, 100] };
  for (const [field, [min, max]] of Object.entries(bounds)) {
    for (const value of [undefined, null, "3", NaN, Infinity, -Infinity, min - 1, max + 1]) {
      assert.throws(() => normalize(fixture({ [field]: value })), `${field}: ${value}`);
    }
    assert.equal(normalize(fixture({ [field]: min })).items[0][field], min);
    assert.equal(normalize(fixture({ [field]: max })).items[0][field], max);
  }
});

test("malformed paths and external paint URLs are rejected", () => {
  for (const badPath of [{ points: null }, { points: [null] }, { points: [{ x: 50 }] },
    { points: [{ x: Infinity, y: 3 }] }, { points: [{ x: -1, y: 3 }] },
    { points: [{ x: 50, y: "3" }] }, { points: [], width: 0 }, { points: [], width: 8 },
    { points: [], width: NaN }, { points: [], color: "url(https://example.com/paint.svg)" },
    { points: [], color: null }]) {
    const value = fixture();
    value.paths = [badPath];
    assert.throws(() => normalize(value));
  }
});

function loaderHarness(mode, input) {
  const initialState = normalize(fixture({ id: "unsaved-item", label: "Unsaved work" }));
  const alerts = [];
  const context = {
    state: clone(initialState), undoStack: [{ existing: "undo" }], redoStack: [{ existing: "redo" }],
    selectedId: "unsaved-item", currentDocumentTitle: "Unsaved plan", renderCount: 0,
    normalizeState: normalize,
    window: { alert: (message) => alerts.push(message) },
    FileReader: class {
      readAsText() {
        if (mode === "throw") throw new Error("I/O failure");
        if (mode === "error") return this.onerror();
        if (mode === "abort") return this.onabort();
        this.result = input;
        this.onload();
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(`
    function recordHistory() {
      undoStack.push({ state: JSON.parse(JSON.stringify(state)), title: currentDocumentTitle });
      redoStack = [];
    }
    function clearSelection() { selectedId = null; }
    function setDocumentTitle(title) { currentDocumentTitle = title; }
    function render() { renderCount++; }
    ${functionSource("titleFromFilename")}
    ${functionSource("loadJson")}
  `, context);
  return { context, alerts, initialState, run: () => context.loadJson({ name: "Imported.json" }) };
}

test("failed JSON/schema imports and file read failures preserve current work, history, selection and title", () => {
  for (const [mode, input] of [["load", "{invalid"], ["load", '{"hello":"world"}'],
    ["load", JSON.stringify(fixture({ x: "50" }))], ["error"], ["abort"], ["throw"]]) {
    const { context, alerts, initialState, run } = loaderHarness(mode, input);
    run();
    assert.deepEqual(clone(context.state), initialState);
    assert.deepEqual(clone(context.undoStack), [{ existing: "undo" }]);
    assert.deepEqual(clone(context.redoStack), [{ existing: "redo" }]);
    assert.equal(context.selectedId, "unsaved-item");
    assert.equal(context.currentDocumentTitle, "Unsaved plan");
    assert.equal(context.renderCount, 0);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /current diagram has been kept/);
  }
});

test("successful import adds one undo entry and only then changes state, selection and title", () => {
  const imported = fixture({ id: "new-item", label: "Loaded ward" });
  const { context, alerts, initialState, run } = loaderHarness("load", JSON.stringify(imported));
  run();
  assert.deepEqual(clone(context.state), normalize(imported));
  assert.equal(context.undoStack.length, 2);
  assert.deepEqual(clone(context.undoStack[1]), { state: initialState, title: "Unsaved plan" });
  assert.equal(context.redoStack.length, 0);
  assert.equal(context.selectedId, null);
  assert.equal(context.currentDocumentTitle, "Imported");
  assert.equal(context.renderCount, 1);
  assert.equal(alerts.length, 0);
});

test("imported labels remain literal text in the layer list, including an XSS payload", () => {
  const payload = '<img src=x onerror="globalThis.attacked=true">';
  class Element {
    constructor(tagName) { this.tagName = tagName; this.children = []; this.dataset = {}; }
    set innerHTML(value) { throw new Error(`HTML insertion is unsafe: ${value}`); }
    appendChild(element) { this.children.push(element); }
    replaceChildren(...elements) { this.children = elements; }
  }
  const layerList = new Element("div");
  const context = {
    state: normalize(fixture({ label: payload })), selectedIds: new Set(), layerList,
    document: { createElement: (tagName) => new Element(tagName) }
  };
  vm.runInNewContext(`${functionSource("renderLayers")}\nrenderLayers();`, context);
  const row = layerList.children[0];
  assert.deepEqual(row.children.map((element) => element.tagName), ["button", "button", "span", "button"]);
  assert.equal(row.children[2].textContent, payload);
  assert.equal(row.children[2].children.length, 0);
  assert.equal(row.children[0].dataset.layerAction, "visibility");
  assert.equal(context.attacked, undefined);
});

test("optional roles and directional arrows survive normalization and saved-file round trips", () => {
  const legacy = normalize(fixture());
  assert.equal(Object.hasOwn(legacy.items[0], "role"), false);
  assert.equal(Object.hasOwn(legacy.paths[0], "arrow"), false);
  for (const role of ["TOP", "JGL", "MID", "BOT", "SUP"]) {
    for (const arrow of [true, false]) {
      const input = fixture({ type: "champion", role, label: role });
      input.paths[0].arrow = arrow;
      const normalized = normalize(input);
      assert.equal(normalized.items[0].role, role);
      assert.equal(normalized.paths[0].arrow, arrow);
      assert.deepEqual(normalize(JSON.parse(JSON.stringify(normalized))), normalized);
    }
  }
});

test("invalid role names and non-boolean directional-arrow flags reject the whole diagram", () => {
  for (const role of [null, 0, true, "", "top", "ADC", "JUNGLE", [], {}]) {
    assert.throws(() => normalize(fixture({ role })), /role/);
  }
  for (const arrow of [null, 0, 1, "true", [], {}]) {
    const input = fixture();
    input.paths[0].arrow = arrow;
    assert.throws(() => normalize(input), /arrow/);
  }
});
