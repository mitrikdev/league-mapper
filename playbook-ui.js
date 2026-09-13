(function () {
  "use strict";

  const storageKey = "rift-playbook-draft-v2";
  const $ = (selector) => document.querySelector(selector);
  const roles = ["TOP", "JGL", "MID", "BOT", "SUP"];
  let book;
  let activeTeam = "blue";
  let presenting = false;
  let previousTool = "select";
  let playback = null;
  let draftTimer = null;
  let toastTimer = null;
  let sceneListKey = "";
  let renderedSceneId = null;
  let allowDraft = true;
  let storageWarningShown = false;

  function notify(message) {
    const toast = $("#toast");
    if (!toast) return;
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("visible");
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 3500);
  }

  function currentScene() { return PlaybookData.active(book); }
  function sync() {
    if (!book) return;
    currentScene().diagram = state;
    book.title = currentDocumentTitle;
  }
  function snapshot() { return PlaybookData.capture(book, state, currentDocumentTitle); }
  function restore(next) {
    stopPlayback();
    clearPointerInteraction();
    book = cloneState(next);
    renderedSceneId = null;
    sceneListKey = "";
  }

  function updateHistory() {
    if ($("#undo-button")) $("#undo-button").disabled = !undoStack.length;
    if ($("#redo-button")) $("#redo-button").disabled = !redoStack.length;
  }

  function saveDraft() {
    clearTimeout(draftTimer);
    if (!book || !allowDraft) return;
    try {
      const draft = snapshot();
      const draftScene = PlaybookData.active(draft);
      // Save in-progress typing without creating an undo entry for every key.
      draftScene.title = $("#scene-title").value.trim().slice(0, 80) || draftScene.title;
      draftScene.note = $("#scene-note").value.slice(0, 2000);
      if ($("#document-title").tagName === "INPUT") draft.title = $("#document-title").value.trim().slice(0, 120) || draft.title;
      localStorage.setItem(storageKey, JSON.stringify(draft));
      $("#save-status").textContent = "Saved on this device";
      $("#save-status").dataset.state = "saved";
    } catch {
      $("#save-status").textContent = "Download to save";
      $("#save-status").dataset.state = "warning";
      if (!storageWarningShown) notify("This browser couldn't save a local draft. Use Save play to keep a copy.");
      storageWarningShown = true;
    }
  }

  function scheduleDraft() {
    if (!allowDraft) return;
    clearTimeout(draftTimer);
    $("#save-status").textContent = "Saving on this device…";
    draftTimer = setTimeout(saveDraft, 500);
  }

  function renderSceneList() {
    const key = JSON.stringify([book.activeSceneId, ...book.scenes.map(scene => [scene.id, scene.title, scene.diagram.items.length, scene.diagram.paths.length])]);
    if (key === sceneListKey) return;
    sceneListKey = key;
    const list = $("#scene-list");
    list.replaceChildren();
    book.scenes.forEach((scene, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `scene-card${scene.id === book.activeSceneId ? " active" : ""}`;
      button.dataset.sceneId = scene.id;
      button.setAttribute("aria-pressed", String(scene.id === book.activeSceneId));
      button.setAttribute("aria-label", `Step ${index + 1}: ${scene.title}`);
      const number = document.createElement("span");
      number.className = "scene-number";
      number.textContent = String(index + 1).padStart(2, "0");
      const name = document.createElement("span");
      name.className = "scene-name";
      name.textContent = scene.title;
      const meta = document.createElement("small");
      meta.className = "scene-meta";
      meta.textContent = `${scene.diagram.items.length} pieces · ${scene.diagram.paths.length} routes`;
      button.append(number, name, meta);
      button.addEventListener("click", () => goToScene(scene.id));
      list.appendChild(button);
    });
  }

  function onRender() {
    if (!book) return;
    sync();
    const scene = currentScene();
    const position = book.scenes.findIndex(candidate => candidate.id === scene.id);
    const stepLabel = `${position + 1} / ${book.scenes.length}`;
    const changedScene = renderedSceneId !== scene.id;
    if (changedScene || document.activeElement !== $("#scene-title")) $("#scene-title").value = scene.title;
    if (changedScene || document.activeElement !== $("#scene-note")) $("#scene-note").value = scene.note;
    renderedSceneId = scene.id;
    $("#active-scene-title").textContent = scene.title;
    $("#scene-counter").textContent = `STEP ${stepLabel}`;
    $("#presentation-title").textContent = scene.title;
    $("#presentation-note").textContent = scene.note || "Use the arrow keys to walk through this play.";
    $("#presentation-counter").textContent = stepLabel;
    [$("#previous-scene"), ...document.querySelectorAll('[data-present-action="previous"]')].forEach(button => { if (button) button.disabled = position === 0; });
    [$("#next-scene"), ...document.querySelectorAll('[data-present-action="next"]')].forEach(button => { if (button) button.disabled = position === book.scenes.length - 1; });
    $("#delete-scene").disabled = book.scenes.length === 1;
    $("#scene-back").disabled = position === 0;
    $("#scene-forward").disabled = position === book.scenes.length - 1;
    $("#add-scene").disabled = book.scenes.length >= 30;
    $("#duplicate-scene").disabled = book.scenes.length >= 30;
    $("#play-button").disabled = book.scenes.length < 2;
    if ($("#clear-drawings")) $("#clear-drawings").disabled = state.paths.length === 0;
    document.querySelectorAll("[data-roster-role]").forEach(button => {
      const item = state.items.find(candidate => candidate.team === activeTeam && candidate.role === button.dataset.rosterRole);
      button.classList.toggle("is-placed", Boolean(item));
      button.classList.toggle("active", Boolean(item && selectedIds.has(item.id)));
      button.dataset.team = activeTeam;
      button.setAttribute("aria-pressed", String(Boolean(item && selectedIds.has(item.id))));
      const status = button.querySelector(".roster-state");
      if (status) status.textContent = item ? "On map" : "+ Add";
    });
    updateHistory();
    renderSceneList();
    scheduleDraft();
  }

  function commitFields() {
    const titleInput = $("#document-title");
    const playTitle = titleInput.tagName === "INPUT" ? titleInput.value.trim().slice(0, 120) || "Untitled play" : currentDocumentTitle;
    const sceneTitle = $("#scene-title").value.trim().slice(0, 80) || "Untitled step";
    const note = $("#scene-note").value.slice(0, 2000);
    if (playTitle === currentDocumentTitle && sceneTitle === currentScene().title && note === currentScene().note) return;
    recordHistory();
    setDocumentTitle(playTitle);
    currentScene().title = sceneTitle;
    currentScene().note = note;
    sync();
    sceneListKey = "";
    onRender();
  }

  function applyBook(next, { record = true, fit = false } = {}) {
    stopPlayback();
    clearPointerInteraction();
    if (record) recordHistory();
    book = next;
    state = currentScene().diagram;
    setDocumentTitle(book.title);
    clearSelection();
    sceneListKey = "";
    render();
    if (fit) resetCamera();
    if (presenting) setTool("pan");
  }

  function goToScene(sceneId, keepPlaying = false) {
    if (!book.scenes.some(scene => scene.id === sceneId)) return;
    if (!keepPlaying) stopPlayback();
    commitFields();
    sync();
    clearPointerInteraction();
    book.activeSceneId = sceneId;
    state = currentScene().diagram;
    clearSelection();
    render();
    $("#scene-list").querySelector(`[data-scene-id="${sceneId}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }

  function navigate(direction, keepPlaying = false) {
    const index = book.scenes.findIndex(scene => scene.id === book.activeSceneId);
    const next = book.scenes[index + direction];
    if (next) goToScene(next.id, keepPlaying);
    else if (keepPlaying) stopPlayback();
  }

  function mutateScenes(action) {
    if (presenting) return;
    commitFields();
    try {
      const next = action(book, state);
      applyBook(next);
      $("#scene-list").querySelector(`[data-scene-id="${book.activeSceneId}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    } catch (error) { notify(error.message); }
  }

  function stopPlayback() {
    if (playback !== null) clearInterval(playback);
    playback = null;
    const button = $("#play-button");
    if (button) { button.textContent = "Play steps"; button.setAttribute("aria-pressed", "false"); }
  }

  function togglePlayback() {
    if (playback !== null) { stopPlayback(); return; }
    if (book.scenes.length < 2) return;
    if (book.activeSceneId === book.scenes.at(-1).id) goToScene(book.scenes[0].id);
    playback = setInterval(() => navigate(1, true), 3500);
    $("#play-button").textContent = "Pause";
    $("#play-button").setAttribute("aria-pressed", "true");
  }

  function setPresenting(value) {
    commitFields();
    stopPlayback();
    clearPointerInteraction();
    presenting = value;
    document.body.classList.toggle("presenting", value);
    if (value) {
      previousTool = activeTool;
      clearSelection();
      setTool("pan");
      hideContextMenu();
      hideQuickViewMenu();
      $("#presentation-bar").querySelector('[data-present-action="exit"]')?.focus();
    } else {
      setTool(previousTool);
      $("#present-button").focus();
    }
    render();
    requestAnimationFrame(() => setZoomAtMapPercent(100, 50, 50));
  }

  function addRole(role) {
    const existing = state.items.find(item => item.team === activeTeam && item.role === role);
    if (existing) {
      if (existing.hidden) { recordHistory(); existing.hidden = false; }
      setLayerFilter(activeTeam, true);
      selectOnly(existing.id);
      setTool("select");
      render();
      centerMapOnItem(existing);
      return;
    }
    recordHistory();
    const center = visibleMapCenter();
    const item = createItem("champion", activeTeam, center.x, center.y, { role, label: role, size: 7 });
    state.items.push(item);
    setLayerFilter(activeTeam, true);
    selectOnly(item.id);
    setTool("select");
    render();
  }

  function examplePlay() {
    const blue = [[27,34],[59,60],[49,48],[75,76],[62,69]];
    const red = [[28,21],[73,55],[56,44],[81,70],[72,61]];
    const pieces = roles.flatMap((role, index) => [
      createItem("champion", "blue", ...blue[index], { role, label: role, size: 7 }),
      createItem("champion", "red", ...red[index], { role, label: role, size: 7 })
    ]);
    pieces.push(createItem("drake-infernal", "neutral", 69, 69, { label: "Dragon", size: 7 }));
    const first = { version: 1, items: pieces, paths: [] };
    let demo = PlaybookData.create(first, "Dragon river control");
    demo.scenes[0].title = "Set up vision";
    demo.scenes[0].note = "Move into river together. Keep mid pressure while your jungler and support establish vision around dragon.";
    demo.scenes[0].diagram.items.push(createItem("ward", "blue", 63, 63, { size: 3, range: 90, label: "River ward" }));
    demo = PlaybookData.addScene(demo, demo.scenes[0].diagram);
    const second = PlaybookData.active(demo);
    second.title = "Control the entrance";
    second.note = "Support and jungle move up as a pair. The rest of the team stays close enough to join the play.";
    second.diagram.items.find(item => item.team === "blue" && item.role === "JGL").x = 64;
    second.diagram.items.find(item => item.team === "blue" && item.role === "SUP").y = 63;
    second.diagram.paths = [{ color: "#80c7ff", width: 4, arrow: true, points: [{x:59,y:60},{x:64,y:60}] }, { color: "#80c7ff", width: 4, arrow: true, points: [{x:62,y:69},{x:62,y:63}] }];
    demo = PlaybookData.addScene(demo, second.diagram);
    const third = PlaybookData.active(demo);
    third.title = "Turn together";
    third.note = "If the enemy contests, turn as a unit. Use this step to discuss the trigger and who starts the engage.";
    third.diagram.items.find(item => item.team === "blue" && item.role === "MID").x = 60;
    third.diagram.items.find(item => item.team === "blue" && item.role === "MID").y = 53;
    third.diagram.items.find(item => item.team === "blue" && item.role === "BOT").x = 71;
    third.diagram.items.find(item => item.team === "blue" && item.role === "BOT").y = 67;
    third.diagram.paths = [{ color: "#e9d589", width: 4, arrow: true, points: [{x:64,y:60},{x:70,y:60}] }, { color: "#80c7ff", width: 4, arrow: true, points: [{x:49,y:48},{x:60,y:53}] }, { color: "#80c7ff", width: 4, arrow: true, points: [{x:75,y:76},{x:71,y:67}] }];
    demo.activeSceneId = demo.scenes[0].id;
    return demo;
  }

  function newPlay(mode, record = true) {
    let next;
    if (mode === "dragon") next = examplePlay();
    else if (mode === "blank") next = PlaybookData.create({ version: 1, items: [], paths: [] });
    else {
      const fullMap = normalizeState(cloneState(window.DEFAULT_START_STATE));
      const names = { top: "TOP", jungler: "JGL", mid: "MID", bot: "BOT", sup: "SUP" };
      fullMap.items.forEach(item => {
        const role = names[item.label.split(" ").at(-1).toLowerCase()];
        if (item.type === "champion" && role) Object.assign(item, { role, label: role, size: 7 });
      });
      next = PlaybookData.create(fullMap, "New Rift play");
    }
    allowDraft = true;
    applyBook(next, { record, fit: true });
    setTool("select");
    saveDraft();
  }

  function save(filename) {
    commitFields();
    saveDraft();
    const name = filename || `${safeFilename(currentDocumentTitle, "rift-play")}.json`;
    download(normalizeJsonFilename(name), JSON.stringify(snapshot(), null, 2), "application/json");
    notify("Play download started, including all steps and notes.");
    return true;
  }

  async function load(file) {
    try {
      const parsed = JSON.parse(await file.text());
      const next = PlaybookData.normalize(parsed, normalizeState, titleFromFilename(file.name).slice(0, 120));
      allowDraft = true;
      applyBook(next, { fit: true });
      saveDraft();
      notify(`Opened ${book.scenes.length} ${book.scenes.length === 1 ? "step" : "steps"}.`);
      return true;
    } catch (error) {
      notify(`Couldn't open this play. ${error instanceof SyntaxError ? "The file is not valid JSON." : error.message} Your current play is unchanged.`);
      return false;
    }
  }

  function handleKeydown(event) {
    const input = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if ($("#shortcuts-dialog")?.open) return true;
    if (!newConfirmModal.classList.contains("hidden")) {
      if (event.key === "Escape") { event.preventDefault(); hideNewConfirm(); }
      if (event.key === "Tab") {
        const buttons = [...newConfirmModal.querySelectorAll("button")];
        const index = buttons.indexOf(document.activeElement);
        const next = (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
        event.preventDefault(); buttons[next]?.focus();
      }
      return true;
    }
    const activatesPlayback = document.activeElement === $("#play-button") && ["Enter", " "].includes(event.key);
    if (!presenting && playback !== null && event.key !== "Tab" && !activatesPlayback) stopPlayback();
    if (presenting) {
      if (event.key === "Escape") setPresenting(false);
      else if (event.key === "ArrowRight") navigate(1);
      else if (event.key === "ArrowLeft") navigate(-1);
      else if (event.key === " ") togglePlayback();
      if (!["Tab", "Enter"].includes(event.key)) event.preventDefault();
      return true;
    }
    if (!input && event.key === "?") {
      event.preventDefault(); $("#shortcuts-dialog").showModal(); return true;
    }
    if (!input && event.key === "f" && !event.ctrlKey && !event.metaKey) {
      event.preventDefault(); setPresenting(true); return true;
    }
    if (!input && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && selectedIds.size) {
      const selected = selectedItems().filter(item => !item.locked && isItemVisible(item));
      if (!selected.length) return true;
      event.preventDefault();
      const step = event.shiftKey ? 2 : 0.5;
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      const changes = selected.map(item => ({ item, x: clamp(item.x + dx, 0, 100), y: clamp(item.y + dy, 0, 100) }))
        .filter(change => change.x !== change.item.x || change.y !== change.item.y);
      if (changes.length) {
        recordHistory();
        changes.forEach(({ item, x, y }) => Object.assign(item, { x, y }));
        render();
      }
      return true;
    }
    return false;
  }

  window.PlaybookUI = { onRender, snapshot, restore, updateHistory, save, load, newPlay, handleKeydown, isPresenting: () => presenting };
  book = examplePlay();
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) book = PlaybookData.normalize(JSON.parse(saved), normalizeState);
  } catch {
    allowDraft = false;
    $("#save-status").textContent = "Draft could not be restored";
    notify("Your stored draft couldn't be opened. It has been kept. Start a new play or load a file to save a new draft.");
  }
  applyBook(book, { record: false, fit: true });
  undoStack = []; redoStack = []; updateHistory();
  setViewToggle("grid", false);
  setTool("select");

  // Editing interrupts playback so focused inputs can never carry into another step.
  [$("#scene-title"), $("#scene-note"), $("#document-title")].forEach(input => {
    input.addEventListener("focus", stopPlayback);
    input.addEventListener("input", scheduleDraft);
  });
  document.addEventListener("pointerdown", event => {
    if (!presenting && !event.target.closest("#play-button")) stopPlayback();
  });
  $("#scene-title").addEventListener("change", commitFields);
  $("#scene-note").addEventListener("change", commitFields);
  $("#document-title").addEventListener("change", commitFields);
  $("#add-scene").addEventListener("click", () => mutateScenes(PlaybookData.addScene));
  $("#duplicate-scene").addEventListener("click", () => mutateScenes(PlaybookData.duplicateScene));
  $("#delete-scene").addEventListener("click", () => mutateScenes(PlaybookData.removeScene));
  $("#scene-back").addEventListener("click", () => mutateScenes((current, diagram) => PlaybookData.moveScene(current, diagram, -1)));
  $("#scene-forward").addEventListener("click", () => mutateScenes((current, diagram) => PlaybookData.moveScene(current, diagram, 1)));
  $("#previous-scene").addEventListener("click", () => navigate(-1));
  $("#next-scene").addEventListener("click", () => navigate(1));
  $("#play-button").addEventListener("click", togglePlayback);
  $("#present-button").addEventListener("click", () => setPresenting(true));
  $("#undo-button").addEventListener("click", undoEditor);
  $("#redo-button").addEventListener("click", redoEditor);
  $("#clear-drawings")?.addEventListener("click", () => {
    if (!state.paths.length) return;
    recordHistory(); state.paths = []; render(); notify("Drawings cleared. Undo to bring them back.");
  });
  document.querySelectorAll("[data-roster-team]").forEach(button => button.addEventListener("click", () => {
    activeTeam = button.dataset.rosterTeam;
    document.querySelectorAll("[data-roster-team]").forEach(candidate => {
      candidate.classList.toggle("active", candidate === button);
      candidate.setAttribute("aria-pressed", String(candidate === button));
    });
    document.querySelectorAll('.quick-palette [data-add]:not([data-add="ping"])').forEach(candidate => {
      candidate.dataset.team = activeTeam;
      const image = candidate.querySelector("img");
      if (image) image.src = `assets/${candidate.dataset.add}-${activeTeam}.svg`;
    });
    onRender();
  }));
  document.querySelectorAll("[data-roster-role]").forEach(button => button.addEventListener("click", () => addRole(button.dataset.rosterRole)));
  document.querySelectorAll("[data-present-action]").forEach(button => button.addEventListener("click", () => {
    const action = button.dataset.presentAction;
    if (action === "exit") setPresenting(false);
    else navigate(action === "previous" ? -1 : 1);
  }));
  $("#help-button").addEventListener("click", () => $("#shortcuts-dialog").showModal());
  $("#shortcuts-dialog").querySelector("[data-close-help]").addEventListener("click", () => $("#shortcuts-dialog").close());
  window.addEventListener("pagehide", () => { commitFields(); saveDraft(); stopPlayback(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { commitFields(); saveDraft(); stopPlayback(); } });
})();
