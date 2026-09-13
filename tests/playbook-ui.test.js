const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { loadEditor } = require("./helpers/editor-harness.cjs");

// Exercise the real controller, editor handlers and history together. The DOM
// adapter supplies browser focus, storage and timers without rendering a map.
function loadPlaybook(savedDraft = null) {
  const editor = loadEditor();
  const context = editor.context;
  const storage = new Map(savedDraft === null ? [] : [["rift-playbook-draft-v2", savedDraft]]);
  const intervals = new Map();
  const timeouts = new Map();
  const windowHandlers = {};
  let timerId = 0;
  context.window.addEventListener = (name, handler) => (windowHandlers[name] ||= []).push(handler);
  context.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  };
  context.setTimeout = callback => { const id = ++timerId; timeouts.set(id, callback); return id; };
  context.clearTimeout = id => timeouts.delete(id);
  context.setInterval = callback => { const id = ++timerId; intervals.set(id, callback); return id; };
  context.clearInterval = id => intervals.delete(id);
  const element = selector => editor.document.querySelector(selector);
  element("#document-title").tagName = "INPUT";
  element("#scene-title").tagName = "INPUT";
  element("#scene-note").tagName = "TEXTAREA";
  element("#new-confirm-modal").classList.add("hidden");
  element("#shortcuts-dialog").querySelector = () => element("#close-help");
  element("#presentation-bar").querySelector = () => element("#presentation-exit");
  for (const selector of ["#document-title", "#scene-title", "#scene-note"]) {
    element(selector).focus = function () {
      editor.document.activeElement = this;
      (this.handlers.focus || []).forEach(handler => handler({ target: this }));
    };
  }
  editor.run("render = function() { window.PlaybookUI?.onRender(); };");
  for (const name of ["playbook-data.js", "playbook-ui.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", name), "utf8"), context, { filename: name });
  }
  function emit(selector, type) {
    const target = element(selector);
    for (const handler of target.handlers[type] || []) handler({ target });
  }
  function click(selector) {
    editor.document.activeElement = element(selector);
    emit(selector, "click");
  }
  function edit(selector, value, commit = true) {
    element(selector).focus();
    element(selector).value = value;
    emit(selector, "input");
    if (commit) emit(selector, "change");
  }
  function key(key, options = {}) {
    for (const handler of editor.document.handlers.keydown || []) {
      handler({ key, preventDefault() {}, ...options });
    }
  }
  return {
    ...editor, element, click, edit, key,
    snapshot: () => editor.result("window.PlaybookUI.snapshot()"),
    intervals,
    tick: () => [...intervals.values()].forEach(callback => callback()),
    pagehide: () => (windowHandlers.pagehide || []).forEach(handler => handler()),
    saved: () => storage.get("rift-playbook-draft-v2"),
    flushDraft: () => [...timeouts.values()].forEach(callback => callback()),
    load: raw => context.window.PlaybookUI.load({ name: "Imported.json", text: async () => JSON.stringify(raw) })
  };
}

test("scene edits and add/remove actions undo and redo the complete playbook", () => {
  const editor = loadPlaybook();
  const original = editor.snapshot();
  editor.edit("#scene-title", "Vision first");
  editor.edit("#scene-note", "Support leads.");
  editor.click("#add-scene");
  const added = editor.snapshot();
  assert.equal(added.scenes.length, 4);
  assert.equal(added.scenes[0].title, "Vision first");
  assert.equal(added.scenes[0].note, "Support leads.");
  assert.equal(added.activeSceneId, added.scenes[1].id);
  editor.click("#undo-button");
  assert.equal(editor.snapshot().scenes.length, 3);
  assert.equal(editor.snapshot().activeSceneId, original.activeSceneId);
  editor.click("#redo-button");
  assert.deepEqual(editor.snapshot(), added);
  editor.click("#delete-scene");
  editor.click("#undo-button");
  assert.deepEqual(editor.snapshot(), added);
  editor.click("#redo-button");
  assert.equal(editor.snapshot().scenes.length, 3);
});

test("scene navigation preserves diagram edits and history returns to the edited scene", () => {
  const editor = loadPlaybook();
  const original = editor.snapshot();
  editor.run('addItem("ward", "blue", 40, 40)');
  const edited = editor.snapshot();
  editor.click("#next-scene");
  assert.deepEqual(editor.snapshot().scenes[0].diagram, edited.scenes[0].diagram);
  editor.click("#undo-button");
  assert.deepEqual(editor.snapshot(), original);
  editor.click("#redo-button");
  const restored = editor.snapshot();
  assert.equal(restored.activeSceneId, original.scenes[1].id);
  assert.deepEqual(restored.scenes[0].diagram, edited.scenes[0].diagram);
  assert.deepEqual(restored.scenes[1].diagram, original.scenes[1].diagram);
});

test("failed imports preserve every scene, history, redo and the stored draft", async () => {
  const editor = loadPlaybook();
  editor.run('addItem("ward", "blue", 40, 40); undoEditor();');
  editor.pagehide();
  const before = editor.snapshot();
  const history = editor.result("({ undo: undoStack.length, redo: redoStack.length })");
  const saved = editor.saved();
  const invalid = JSON.parse(JSON.stringify(before));
  invalid.scenes[2].diagram.items[0].x = 101;
  assert.equal(await editor.load(invalid), false);
  assert.deepEqual(editor.snapshot(), before);
  assert.deepEqual(editor.result("({ undo: undoStack.length, redo: redoStack.length })"), history);
  assert.equal(editor.saved(), saved);
});

test("legacy loads remain reversible together with the play title and all prior scenes", async () => {
  const editor = loadPlaybook();
  editor.edit("#document-title", "Our original play");
  editor.click("#next-scene");
  const original = editor.snapshot();
  assert.equal(await editor.load({ version: 1, items: [], paths: [] }), true);
  assert.equal(editor.snapshot().title, "Imported");
  assert.equal(editor.snapshot().scenes.length, 1);
  editor.click("#undo-button");
  assert.deepEqual(editor.snapshot(), original);
  editor.click("#redo-button");
  assert.equal(editor.snapshot().title, "Imported");
  assert.equal(editor.snapshot().scenes.length, 1);
});

test("page exit commits the focused note and saves the entire playbook for restore", () => {
  const editor = loadPlaybook();
  editor.edit("#document-title", "Weekend practice");
  editor.edit("#scene-note", "Wait until mid can move.", false);
  editor.pagehide();
  const saved = JSON.parse(editor.saved());
  assert.equal(saved.title, "Weekend practice");
  assert.equal(saved.scenes[0].note, "Wait until mid can move.");
  assert.equal(saved.scenes.length, 3);
  assert.deepEqual(loadPlaybook(editor.saved()).snapshot(), saved);
});

test("focused input autosaves without history entries and empty titles wait for a committed change", () => {
  const fieldValue = (book, selector) => selector === "#document-title" ? book.title :
    book.scenes.find(scene => scene.id === book.activeSceneId)[selector === "#scene-title" ? "title" : "note"];
  for (const selector of ["#scene-note", "#scene-title", "#document-title"]) {
    const editor = loadPlaybook();
    editor.flushDraft();
    const original = editor.snapshot();
    const undoCount = editor.run("undoStack.length");
    editor.edit(selector, "Pending text before blur", false);
    assert.equal(editor.element("#save-status").textContent, "Saving on this device…");
    editor.flushDraft();
    assert.equal(editor.document.activeElement, editor.element(selector));
    assert.equal(fieldValue(JSON.parse(editor.saved()), selector), "Pending text before blur");
    assert.equal(editor.element("#save-status").textContent, "Saved on this device");
    assert.deepEqual(editor.snapshot(), original);
    assert.equal(editor.run("undoStack.length"), undoCount);
    assert.equal(fieldValue(loadPlaybook(editor.saved()).snapshot(), selector), "Pending text before blur");
  }
  for (const selector of ["#scene-title", "#document-title"]) {
    const editor = loadPlaybook();
    editor.flushDraft();
    const original = editor.snapshot();
    const undoCount = editor.run("undoStack.length");
    editor.edit(selector, "", false);
    editor.flushDraft();
    assert.equal(fieldValue(JSON.parse(editor.saved()), selector), fieldValue(original, selector));
    assert.deepEqual(editor.snapshot(), original);
    assert.equal(editor.run("undoStack.length"), undoCount);
    editor.edit(selector, "", true);
    editor.flushDraft();
    const fallback = selector === "#scene-title" ? "Untitled step" : "Untitled play";
    assert.equal(fieldValue(editor.snapshot(), selector), fallback);
    assert.equal(fieldValue(JSON.parse(editor.saved()), selector), fallback);
    assert.equal(editor.run("undoStack.length"), undoCount + 1);
  }
});

test("focusing a scene field stops playback before notes can spill into other scenes", () => {
  for (const selector of ["#scene-note", "#scene-title", "#document-title"]) {
    const editor = loadPlaybook();
    const before = editor.snapshot();
    editor.click("#play-button");
    assert.equal(editor.intervals.size, 1);
    editor.edit(selector, "A newly edited field", false);
    assert.equal(editor.intervals.size, 0);
    editor.tick();
    editor.pagehide();
    const after = editor.snapshot();
    assert.equal(after.activeSceneId, before.activeSceneId);
    assert.deepEqual(after.scenes.slice(1), before.scenes.slice(1));
  }
});

test("Enter and Space activate the focused Play button once so playback can pause", () => {
  for (const key of ["Enter", " "]) {
    const editor = loadPlaybook();
    editor.click("#play-button");
    assert.equal(editor.intervals.size, 1);
    // Native buttons dispatch a click after keyboard activation. The keydown
    // guard must leave toggling to that click, rather than toggling twice.
    editor.key(key);
    assert.equal(editor.intervals.size, 1);
    editor.click("#play-button");
    assert.equal(editor.intervals.size, 0);
    editor.key(key);
    editor.click("#play-button");
    assert.equal(editor.intervals.size, 1);
    editor.key("Escape");
    assert.equal(editor.intervals.size, 0);
  }
});

test("nudging against each map boundary preserves redo until a token actually moves", () => {
  for (const [key, x, y, back, expected] of [
    ["ArrowLeft", 0, 40, "ArrowRight", [0.5, 40]],
    ["ArrowRight", 100, 40, "ArrowLeft", [99.5, 40]],
    ["ArrowUp", 40, 0, "ArrowDown", [40, 0.5]],
    ["ArrowDown", 40, 100, "ArrowUp", [40, 99.5]]
  ]) {
    const editor = loadPlaybook();
    editor.run('addItem("ward", "blue", ' + x + ', ' + y + '); addItem("ward", "blue", 20, 20); undoEditor(); selectOnly(state.items.at(-1).id);');
    const before = editor.snapshot();
    const history = editor.result("({ undo: undoStack.length, redo: redoStack.length })");
    editor.key(key);
    editor.key(key, { shiftKey: true });
    assert.deepEqual(editor.snapshot(), before);
    assert.deepEqual(editor.result("({ undo: undoStack.length, redo: redoStack.length })"), history);
    editor.key(back);
    assert.deepEqual(editor.result("[selectedItem().x, selectedItem().y]"), expected);
    assert.equal(editor.run("undoStack.length"), history.undo + 1);
    assert.equal(editor.run("redoStack.length"), 0);
    editor.click("#undo-button");
    assert.deepEqual(editor.snapshot(), before);
  }
});

test("presentation navigation preserves content and blocks editor delete shortcuts", () => {
  const editor = loadPlaybook();
  const original = editor.snapshot();
  editor.run("selectOnly(state.items[0].id)");
  editor.click("#present-button");
  assert.equal(editor.run("window.PlaybookUI.isPresenting()"), true);
  editor.key("Delete");
  editor.key("ArrowRight");
  const presented = editor.snapshot();
  assert.equal(presented.activeSceneId, original.scenes[1].id);
  assert.deepEqual(presented.scenes, original.scenes);
  editor.key("Escape");
  assert.equal(editor.run("window.PlaybookUI.isPresenting()"), false);
});

test("an unreadable stored draft is retained until the user explicitly starts another play", () => {
  const corrupt = '{"version":2,"scenes":[]}';
  const editor = loadPlaybook(corrupt);
  editor.flushDraft();
  editor.pagehide();
  assert.equal(editor.saved(), corrupt);
  editor.run('window.PlaybookUI.newPlay("blank")');
  assert.equal(JSON.parse(editor.saved()).scenes.length, 1);
  assert.deepEqual(JSON.parse(editor.saved()).scenes[0].diagram.items, []);
});

test("changing team perspective covers every step, survives navigation, and is reversible", () => {
  const editor = loadPlaybook();
  const original = editor.snapshot();
  editor.run("window.PlaybookUI.setPerspective('blue')");
  assert.equal(editor.run("undoStack.length"), 1);
  assert.ok(editor.snapshot().scenes.every(scene => scene.diagram.vision.perspective === "blue"));
  editor.click("#next-scene");
  const blueAtNextStep = editor.snapshot();
  assert.equal(blueAtNextStep.activeSceneId, original.scenes[1].id);
  assert.equal(editor.run("state.vision.perspective"), "blue");
  editor.run("window.PlaybookUI.setPerspective('blue')");
  assert.equal(editor.run("undoStack.length"), 1, "selecting the same perspective is not an edit");
  editor.run("window.PlaybookUI.setPerspective('red')");
  const redAtNextStep = editor.snapshot();
  assert.ok(redAtNextStep.scenes.every(scene => scene.diagram.vision.perspective === "red"));
  editor.click("#undo-button");
  assert.deepEqual(editor.snapshot(), blueAtNextStep);
  editor.click("#undo-button");
  assert.deepEqual(editor.snapshot(), original);
  editor.click("#redo-button");
  assert.deepEqual(editor.snapshot(), blueAtNextStep);
  editor.click("#redo-button");
  assert.deepEqual(editor.snapshot(), redAtNextStep);
  editor.pagehide();
  const restored = loadPlaybook(editor.saved());
  assert.deepEqual(restored.snapshot(), redAtNextStep);
  restored.click("#next-scene");
  assert.equal(restored.run("state.vision.perspective"), "red");
});

test("presentation vision selectors keep their native keyboard controls while Escape exits", () => {
  const editor = loadPlaybook();
  editor.click("#present-button");
  const original = editor.snapshot();
  const select = editor.element("#presentation-vision-test-select");
  select.tagName = "SELECT";
  select.focus();
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "Enter", "b", "r"]) {
    let prevented = false;
    editor.key(key, { preventDefault() { prevented = true; } });
    assert.equal(prevented, false, `${key} remains available to the native selector`);
    assert.deepEqual(editor.snapshot(), original, `${key} cannot navigate to another step`);
    assert.equal(editor.intervals.size, 0, `${key} cannot start playback`);
    assert.equal(editor.run("window.PlaybookUI.isPresenting()"), true);
  }
  editor.key("Escape");
  assert.equal(editor.run("window.PlaybookUI.isPresenting()"), false);
});
