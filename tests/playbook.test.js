const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const PlaybookData = require("../playbook-data.js");
const DiagramData = require("../diagram-data.js");

const clone = (value) => JSON.parse(JSON.stringify(value));
const normalizeDiagram = (value) => DiagramData.normalizeState(value, ["ward"]);
const normalize = (value, title) => PlaybookData.normalize(value, normalizeDiagram, title);

function diagram(x = 42) {
  return normalizeDiagram({
    version: 1,
    items: [{ id: "ward-1", type: "ward", team: "blue", x, y: 73,
      size: 2, range: 190, opacity: 100, label: "Vision" }],
    paths: [{ color: "#f0d66a", width: 4, points: [{ x: 0, y: 100 }, { x: 25, y: 50 }] }]
  });
}

function threeScenes() {
  let book = PlaybookData.create(diagram(), "Dragon setup");
  book = PlaybookData.addScene(book, diagram(45));
  return PlaybookData.addScene(book, diagram(55));
}

test("legacy diagrams migrate into one named setup scene and round-trip as playbooks", () => {
  const legacy = diagram();
  const book = normalize(legacy, "Baron contest");
  assert.equal(book.version, 2);
  assert.equal(book.title, "Baron contest");
  assert.equal(book.scenes.length, 1);
  assert.equal(book.scenes[0].title, "Setup");
  assert.equal(book.scenes[0].note, "");
  assert.equal(book.activeSceneId, book.scenes[0].id);
  assert.deepEqual(book.scenes[0].diagram, legacy);
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(book))), book);
  assert.equal(normalize(legacy).title, "Untitled play");
  book.scenes[0].diagram.paths[0].points[0].x = 99;
  assert.equal(legacy.paths[0].points[0].x, 0);
});

test("multi-scene imports preserve order, active scene and coaching notes", () => {
  const book = threeScenes();
  book.scenes[1].note = "Wait for their jungler, then engage.\nKeep vision on the river.";
  book.activeSceneId = book.scenes[1].id;
  const imported = normalize(JSON.parse(JSON.stringify(book)));
  assert.deepEqual(imported, book);
  assert.equal(PlaybookData.active(imported).note, book.scenes[1].note);
  imported.scenes[0].diagram.items[0].x = 1;
  imported.scenes[1].diagram.paths[0].points[0].x = 1;
  assert.equal(book.scenes[0].diagram.items[0].x, 45);
  assert.equal(book.scenes[1].diagram.paths[0].points[0].x, 0);
});

test("malformed playbooks, duplicate IDs and missing active scenes are rejected", () => {
  const good = threeScenes();
  const invalid = [null, [], "play", {}, { ...good, version: 3 }, { ...good, version: "2" },
    { ...good, title: null }, { ...good, title: "a".repeat(121) }, { ...good, scenes: null },
    { ...good, scenes: [] }, { ...good, scenes: Array.from({ length: 31 }, () => good.scenes[0]) },
    { ...good, scenes: [null] }, { ...good, activeSceneId: "missing" },
    { ...good, activeSceneId: {} }, { ...good, scenes: [good.scenes[0], good.scenes[0]] }];
  for (const value of invalid) assert.throws(() => normalize(value));
  for (const override of [{ id: "" }, { id: "bad id" }, { id: "x".repeat(129) },
    { id: 1 }, { title: undefined }, { title: "a".repeat(81) }, { note: 0 },
    { note: "a".repeat(2001) }, { diagram: null }, { diagram: { version: 1, items: [] } }]) {
    const value = clone(good);
    Object.assign(value.scenes[1], override);
    assert.throws(() => normalize(value), JSON.stringify(override));
  }
  assert.throws(() => PlaybookData.normalize(good), /validation function/);
});

test("a bad later diagram fails the whole import without changing the source", () => {
  const source = threeScenes();
  source.scenes[2].diagram.items[0].x = 101;
  const before = clone(source);
  assert.throws(() => normalize(source), /between 0 and 100/);
  assert.deepEqual(source, before);
  const mutatingValidator = (value) => {
    value.items[0].label = "changed by validator";
    throw new Error("Invalid diagram");
  };
  assert.throws(() => PlaybookData.normalize(source, mutatingValidator), /Invalid diagram/);
  assert.deepEqual(source, before);
});

test("capture saves the current editor into the active scene and leaves all inputs detached", () => {
  const book = threeScenes();
  const original = clone(book);
  const editor = diagram(63);
  const result = PlaybookData.capture(book, editor, "New title");
  assert.equal(result.title, "New title");
  assert.equal(PlaybookData.active(result).diagram.items[0].x, 63);
  result.scenes[0].diagram.items[0].x = 7;
  PlaybookData.active(result).diagram.paths[0].points[0].x = 7;
  assert.deepEqual(book, original);
  assert.equal(editor.paths[0].points[0].x, 0);
  assert.throws(() => PlaybookData.capture(book, editor, "a".repeat(121)), /120/);
  assert.deepEqual(book, original);
});

test("adding after the active scene captures unsaved edits and starts a fresh note", () => {
  const book = threeScenes();
  book.activeSceneId = book.scenes[0].id;
  book.scenes[0].note = "The initial setup";
  const before = clone(book);
  const result = PlaybookData.addScene(book, diagram(65));
  const added = PlaybookData.active(result);
  assert.equal(result.scenes.indexOf(added), 1);
  assert.equal(result.scenes.length, 4);
  assert.equal(added.title, "Step 4");
  assert.equal(added.note, "");
  assert.equal(result.scenes[0].diagram.items[0].x, 65);
  assert.equal(added.diagram.items[0].x, 65);
  assert.equal(new Set(result.scenes.map((scene) => scene.id)).size, 4);
  added.diagram.items[0].x = 80;
  added.diagram.paths[0].points[0].x = 80;
  assert.equal(result.scenes[0].diagram.items[0].x, 65);
  assert.equal(result.scenes[0].diagram.paths[0].points[0].x, 0);
  assert.deepEqual(book, before);
});

test("duplicates copy notes and unsaved diagrams using a fresh ID and bounded title", () => {
  const book = PlaybookData.create(diagram());
  book.scenes[0].title = "a".repeat(80);
  book.scenes[0].note = "Press forward together";
  const result = PlaybookData.duplicateScene(book, diagram(77));
  const copy = PlaybookData.active(result);
  assert.notEqual(copy.id, book.activeSceneId);
  assert.equal(copy.title.length, 80);
  assert.ok(copy.title.endsWith(" copy"));
  assert.equal(copy.note, book.scenes[0].note);
  assert.equal(copy.diagram.items[0].x, 77);
  copy.diagram.items[0].x = 2;
  assert.equal(result.scenes[0].diagram.items[0].x, 77);
  assert.equal(book.scenes[0].diagram.items[0].x, 42);
  assert.deepEqual(normalize(result), result);
});

test("removing a scene selects its predecessor, or the next scene when removing the first", () => {
  const book = threeScenes();
  const before = clone(book);
  let removed = PlaybookData.removeScene(book, diagram());
  assert.equal(removed.scenes.length, 2);
  assert.equal(removed.activeSceneId, book.scenes[1].id);
  book.activeSceneId = book.scenes[0].id;
  removed = PlaybookData.removeScene(book, diagram());
  assert.equal(removed.activeSceneId, book.scenes[1].id);
  assert.deepEqual(removed.scenes.map((scene) => scene.id), before.scenes.slice(1).map((scene) => scene.id));
  removed.scenes[0].diagram.paths[0].points[0].x = 9;
  assert.equal(book.scenes[1].diagram.paths[0].points[0].x, 0);
  const one = PlaybookData.create(diagram());
  assert.throws(() => PlaybookData.removeScene(one, diagram()), /at least one/);
  assert.equal(one.scenes.length, 1);
});

test("reordering keeps the active ID and captures edits even at an ordering boundary", () => {
  const book = threeScenes();
  const ids = book.scenes.map((scene) => scene.id);
  const moved = PlaybookData.moveScene(book, diagram(61), -1);
  assert.deepEqual(moved.scenes.map((scene) => scene.id), [ids[0], ids[2], ids[1]]);
  assert.equal(moved.activeSceneId, ids[2]);
  assert.equal(PlaybookData.active(moved).diagram.items[0].x, 61);
  const back = PlaybookData.moveScene(moved, diagram(62), 1);
  assert.deepEqual(back.scenes.map((scene) => scene.id), ids);
  const bounded = PlaybookData.moveScene(back, diagram(63), 1);
  assert.deepEqual(bounded.scenes.map((scene) => scene.id), ids);
  assert.equal(PlaybookData.active(bounded).diagram.items[0].x, 63);
  bounded.activeSceneId = ids[0];
  const first = PlaybookData.moveScene(bounded, diagram(64), -1);
  assert.deepEqual(first.scenes.map((scene) => scene.id), ids);
  assert.equal(PlaybookData.active(first).diagram.items[0].x, 64);
  assert.deepEqual(book.scenes.map((scene) => scene.id), ids);
  assert.throws(() => PlaybookData.moveScene(book, diagram(), 0), /direction/);
});

test("the maximum scene count and exact text limits survive save and reload", () => {
  let book = PlaybookData.create(diagram(), "a".repeat(120));
  while (book.scenes.length < 30) book = PlaybookData.addScene(book, diagram());
  book.scenes[0].title = "b".repeat(80);
  book.scenes[0].note = "c".repeat(2000);
  assert.deepEqual(normalize(book), book);
  assert.throws(() => PlaybookData.addScene(book, diagram()), /30/);
  assert.throws(() => PlaybookData.duplicateScene(book, diagram()), /30/);
  assert.equal(book.scenes.length, 30);
});

test("classic browser script exposes the same API and handles ID collisions", () => {
  const source = fs.readFileSync(path.join(__dirname, "../playbook-data.js"), "utf8");
  const context = { crypto: { randomUUID: () => "test-uuid" } };
  vm.runInNewContext(source, context);
  const api = context.PlaybookData;
  assert.deepEqual(Object.keys(api).sort(), Object.keys(PlaybookData).sort());
  let book = api.create(diagram());
  book = api.addScene(book, diagram());
  book = api.addScene(book, diagram());
  assert.equal(new Set(book.scenes.map((scene) => scene.id)).size, 3);
  assert.equal(book.scenes[2].id, "scene-test-uuid-3");
});
