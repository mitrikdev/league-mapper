const diagram = document.querySelector("#diagram");
const canvasWrap = document.querySelector(".canvas-wrap");
const objectLayer = document.querySelector("#object-layer");
const drawLayer = document.querySelector("#draw-layer");
const layerList = document.querySelector("#layer-list");
const fileInput = document.querySelector("#file-input");
const props = document.querySelector("#properties");
const emptyState = document.querySelector("#empty-state");
const selectionBulk = document.querySelector("#selection-bulk");
const documentTitle = document.querySelector("#document-title");
const zoomSlider = document.querySelector("#zoom");
const zoomInput = document.querySelector("#zoom-input");
const drawSettings = document.querySelector("#draw-settings");
const brushWidthInput = document.querySelector("#brush-width");
const newConfirmModal = document.querySelector("#new-confirm-modal");
const newMenu = document.querySelector("#new-menu");
const contextMenu = document.createElement("div");
const quickViewMenu = document.createElement("div");
const selectionBox = document.createElement("div");

const propLabel = document.querySelector("#prop-label");
const propSize = document.querySelector("#prop-size");
const propCloaked = document.querySelector("#prop-cloaked");
const propRange = document.querySelector("#prop-range");

let state = {
  version: 1,
  items: [],
  paths: []
};

let selectedId = null;
let selectedIds = new Set();
let activeTool = "select";
let drag = null;
let activePath = null;
let brushWidth = 4;
let brushColor = "#f0d66a";
let undoStack = [];
let redoStack = [];
let isRestoringHistory = false;
let filters = {
  blue: true,
  red: true,
  neutral: true,
  ward: true,
  minion: true,
  drawings: true
};
let zoom = 100;
let panX = 0;
let panY = 0;
let panDrag = null;
let boxSelect = null;
let suppressNextContextMenu = false;
let lastLayerClick = { id: null, time: 0 };
let quickViewDrag = null;
let pendingNewMode = "default";
let currentDocumentTitle = "Game Start";

contextMenu.className = "context-menu hidden";
document.body.appendChild(contextMenu);
quickViewMenu.className = "quick-view-menu hidden";
document.body.appendChild(quickViewMenu);
selectionBox.className = "selection-box hidden";
diagram.appendChild(selectionBox);

const defaults = {
  champion: { size: 3, range: 0, label: "Champion" },
  clone: { size: 3, range: 0, label: "Clone" },
  ward: { size: 2, range: 190, label: "Ward" },
  minion: { size: 2, range: 0, label: "Minion" },
  cannon: { size: 2, range: 0, label: "Cannon Minion" },
  "super-minion": { size: 3, range: 0, label: "Super Minion" },
  turret: { size: 4, range: 0, label: "Turret" },
  inhibitor: { size: 4, range: 0, label: "Inhibitor" },
  pet: { size: 2, range: 0, label: "Pet" },
  gromp: { size: 3, range: 0, label: "Gromp" },
  wolves: { size: 3, range: 0, label: "Wolves" },
  krugs: { size: 3, range: 0, label: "Krugs" },
  raptors: { size: 3, range: 0, label: "Raptors" },
  "red-brambleback": { size: 4, range: 0, label: "Red Brambleback" },
  "blue-sentinel": { size: 4, range: 0, label: "Blue Sentinel" },
  scuttler: { size: 3, range: 0, label: "Scuttler" },
  "scuttler-enhanced": { size: 4, range: 0, label: "Void Rift Scuttler" },
  "drake-infernal": { size: 5, range: 0, label: "Infernal Drake" },
  "drake-mountain": { size: 5, range: 0, label: "Mountain Drake" },
  "drake-ocean": { size: 5, range: 0, label: "Ocean Drake" },
  "drake-cloud": { size: 5, range: 0, label: "Cloud Drake" },
  "drake-hextech": { size: 5, range: 0, label: "Hextech Drake" },
  "drake-chemtech": { size: 5, range: 0, label: "Chemtech Drake" },
  "drake-elder": { size: 6, range: 0, label: "Elder Drake" },
  voidgrubs: { size: 4, range: 0, label: "Voidgrubs" },
  "rift-herald": { size: 6, range: 0, label: "Rift Herald" },
  baron: { size: 7, range: 0, label: "Baron" },
  ping: { size: 3, range: 0, label: "Ping" }
};

const defaultItemState = {
  hidden: false,
  locked: false,
  cloaked: false,
  groupId: null
};

const neutralOnlyTypes = new Set([
  "wolves",
  "gromp",
  "krugs",
  "raptors",
  "red-brambleback",
  "blue-sentinel",
  "scuttler",
  "scuttler-enhanced",
  "drake-infernal",
  "drake-mountain",
  "drake-ocean",
  "drake-cloud",
  "drake-hextech",
  "drake-chemtech",
  "drake-elder",
  "voidgrubs",
  "rift-herald",
  "baron"
]);

function id() {
  return `item-${crypto.randomUUID()}`;
}

function assetFor(item) {
  if (item.type === "ping") return "assets/ping.svg";
  if (neutralOnlyTypes.has(item.type)) return `assets/${item.type}-neutral.svg`;
  return `assets/${item.type}-${item.team}.svg`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pointFromEvent(event) {
  const rect = diagram.getBoundingClientRect();
  return {
    x: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
    y: clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100)
  };
}

function setSelectionBox(start, end) {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  selectionBox.style.left = `${left}%`;
  selectionBox.style.top = `${top}%`;
  selectionBox.style.width = `${width}%`;
  selectionBox.style.height = `${height}%`;
}

function selectItemsInBox(start, end) {
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  const matched = state.items.filter((item) => isItemVisible(item) && !item.locked && (
    item.x >= minX && item.x <= maxX && item.y >= minY && item.y <= maxY
  ));

  selectedIds = new Set(matched.map((item) => item.id));
  selectedId = matched.at(-1)?.id || null;
  render();
}

function addItem(type, team, x = 50, y = 50) {
  const template = defaults[type];
  recordHistory();
  const item = createItem(type, team, x, y);
  state.items.push(item);
  selectOnly(item.id);
  render();
}

function createItem(type, team, x, y, overrides = {}) {
  const template = defaults[type];
  return {
    id: id(),
    type,
    team,
    x,
    y,
    size: template.size,
    range: template.range,
    opacity: 100,
    ...defaultItemState,
    label: template.label,
    ...overrides
  };
}

function selectedItem() {
  return state.items.find((item) => item.id === selectedId);
}

function selectedItems() {
  return state.items.filter((item) => selectedIds.has(item.id));
}

function selectOnly(id, { visibleOnly = false } = {}) {
  const item = state.items.find((candidate) => candidate.id === id);
  if (item?.groupId) {
    const groupIds = state.items.filter((candidate) => candidate.groupId === item.groupId && (!visibleOnly || isItemVisible(candidate))).map((candidate) => candidate.id);
    selectedId = id;
    selectedIds = new Set(groupIds);
    return;
  }
  selectedId = id;
  selectedIds = id ? new Set([id]) : new Set();
}

function addToSelection(id) {
  if (!id) return;
  selectedIds.add(id);
  selectedId = id;
}

function clearSelection() {
  selectedId = null;
  selectedIds.clear();
}

function normalizeState(nextState) {
  return DiagramData.normalizeState(nextState, Object.keys(defaults));
}
function isItemVisible(item, currentFilters = filters) {
  if (item.hidden || currentFilters[item.team] === false) return false;
  if (item.type === "ward" && !currentFilters.ward) return false;
  if (["minion", "cannon", "super-minion"].includes(item.type) && !currentFilters.minion) return false;
  return true;
}

function setLayerFilter(key, checked) {
  filters[key] = checked;
  const visibleIds = new Set(state.items.filter((item) => isItemVisible(item)).map((item) => item.id));
  selectedIds = new Set([...selectedIds].filter((id) => visibleIds.has(id)));
  if (!selectedIds.has(selectedId)) selectedId = selectedItems().at(-1)?.id || null;
  const sidebarFilter = document.querySelector(`[data-filter="${key}"]`);
  if (sidebarFilter) sidebarFilter.checked = checked;
  syncQuickViewChecks();
  render();
}

function render() {
  objectLayer.innerHTML = "";

  for (const item of state.items) {
    if (!isItemVisible(item)) continue;
    const iconSize = Math.max(item.size * 4, 6);
    const hitSize = Math.max(iconSize + 8, 16);
    const token = document.createElement("button");
    token.className = `token team-${item.team}${selectedIds.has(item.id) ? " selected" : ""}${item.locked ? " locked" : ""}`;
    token.dataset.id = item.id;
    token.style.left = `${item.x}%`;
    token.style.top = `${item.y}%`;
    token.style.width = `${hitSize}px`;
    token.style.height = `${hitSize}px`;
    token.style.opacity = String((item.opacity / 100) * (item.cloaked ? 0.4 : 1));
    token.style.setProperty("--range", `${item.range}px`);
    token.style.setProperty("--icon-size", `${iconSize}px`);
    token.title = item.label;
    token.setAttribute("aria-label", item.label);

    if (item.range > 0) {
      const ring = document.createElement("span");
      ring.className = "range-ring";
      token.appendChild(ring);
    }

    const img = document.createElement("img");
    img.className = "token-img";
    img.src = assetFor(item);
    img.alt = "";
    token.appendChild(img);

    const label = document.createElement("span");
    label.className = "token-label";
    label.textContent = item.label;
    token.appendChild(label);

    objectLayer.appendChild(token);
  }

  drawLayer.innerHTML = "";
  state.paths.forEach((path, index) => {
    if (!filters.drawings) return;
    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("class", "path-line");
    polyline.dataset.pathIndex = String(index);
    polyline.setAttribute("stroke-width", String(path.width || 7));
    polyline.setAttribute("stroke", path.color || "#f0d66a");
    polyline.setAttribute("points", path.points.map((point) => `${point.x * 10},${point.y * 10}`).join(" "));
    drawLayer.appendChild(polyline);
  });

  renderProperties();
  renderLayers();
}

function renderProperties() {
  const item = selectedItem();
  const canEdit = Boolean(item) && selectedIds.size === 1 && !item.locked;
  props.classList.toggle("hidden", !canEdit);
  selectionBulk.classList.toggle("hidden", !selectedIds.size);
  emptyState.classList.toggle("hidden", canEdit);
  emptyState.textContent = item?.locked ? "Selected item is locked." : selectedIds.size > 1 ? `${selectedIds.size} items selected.` : "Select an item.";

  if (!canEdit) return;

  propLabel.value = item.label;
  propSize.value = item.size;
  propCloaked.checked = Boolean(item.cloaked);
  propRange.value = item.range;
}

function renderLayers() {
  layerList.replaceChildren();
  [...state.items].reverse().forEach((item) => {
    const row = document.createElement("div");
    row.className = `layer-row${selectedIds.has(item.id) ? " active" : ""}${item.hidden ? " is-hidden" : ""}`;
    row.dataset.id = item.id;

    const addAction = (action, title, text) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.layerAction = action;
      button.title = title;
      button.textContent = text;
      row.appendChild(button);
    };

    addAction("visibility", item.hidden ? "Show" : "Hide", item.hidden ? "H" : "V");
    addAction("lock", item.locked ? "Unlock" : "Lock", item.locked ? "L" : "U");
    const label = document.createElement("span");
    label.textContent = item.label;
    row.appendChild(label);
    addAction("rename", "Rename", "R");
    layerList.appendChild(row);
  });
}
function itemById(idValue) {
  return state.items.find((item) => item.id === idValue);
}

function toggleLayerVisibility(idValue) {
  const item = itemById(idValue);
  if (!item) return;
  recordHistory();
  item.hidden = !item.hidden;
  if (item.hidden) selectedIds.delete(item.id);
  if (selectedId === item.id && item.hidden) selectedId = selectedItems().at(-1)?.id || null;
  render();
}

function toggleLayerLock(idValue) {
  const item = itemById(idValue);
  if (!item) return;
  recordHistory();
  item.locked = !item.locked;
  render();
}

function renameLayer(idValue) {
  const item = itemById(idValue);
  if (!item) return;
  const nextLabel = window.prompt("Rename layer:", item.label);
  if (nextLabel === null) return;
  const trimmed = nextLabel.trim();
  if (!trimmed || trimmed === item.label) return;
  recordHistory();
  item.label = trimmed;
  render();
}

function moveSelectionInLayerOrder(direction) {
  const selected = selectedItems();
  if (!selected.length) return;
  recordHistory();
  const ids = new Set(selected.map((item) => item.id));
  const ordered = state.items.filter((item) => !ids.has(item.id));
  if (direction === "front") {
    state.items = [...ordered, ...selected];
  } else {
    state.items = [...selected, ...ordered];
  }
  render();
}

function groupSelection() {
  const selected = selectedItems();
  if (selected.length < 2) return;
  recordHistory();
  const groupId = `group-${crypto.randomUUID()}`;
  selected.forEach((item) => {
    item.groupId = groupId;
  });
  render();
}

function ungroupSelection() {
  const selected = selectedItems().filter((item) => item.groupId);
  if (!selected.length) return;
  recordHistory();
  selected.forEach((item) => {
    item.groupId = null;
  });
  render();
}

function alignSelection(axis) {
  const selected = selectedItems().filter((item) => !item.locked);
  if (selected.length < 2) return;
  recordHistory();
  const average = selected.reduce((total, item) => total + item[axis], 0) / selected.length;
  selected.forEach((item) => {
    item[axis] = average;
  });
  render();
}

function distributeSelection(axis) {
  const selected = selectedItems().filter((item) => !item.locked).sort((a, b) => a[axis] - b[axis]);
  if (selected.length < 3) return;
  recordHistory();
  const first = selected[0][axis];
  const last = selected[selected.length - 1][axis];
  const step = (last - first) / (selected.length - 1);
  selected.forEach((item, index) => {
    item[axis] = first + step * index;
  });
  render();
}

function runSelectionAction(action) {
  const actions = {
    "align-x": () => alignSelection("x"),
    "align-y": () => alignSelection("y"),
    "distribute-x": () => distributeSelection("x"),
    "distribute-y": () => distributeSelection("y"),
    front: () => moveSelectionInLayerOrder("front"),
    back: () => moveSelectionInLayerOrder("back"),
    group: groupSelection,
    ungroup: ungroupSelection
  };
  actions[action]?.();
}

function duplicateSelection() {
  const selected = selectedItems();
  if (!selected.length) return;
  recordHistory();
  const groupMap = new Map();
  const copies = selected.map((item) => ({
    ...cloneState(item),
    id: id(),
    groupId: item.groupId ? (groupMap.get(item.groupId) || groupMap.set(item.groupId, `group-${crypto.randomUUID()}`).get(item.groupId)) : null,
    x: clamp(item.x + 4, 0, 100),
    y: clamp(item.y + 4, 0, 100)
  }));
  state.items.push(...copies);
  selectedIds = new Set(copies.map((item) => item.id));
  selectedId = copies.at(-1)?.id || null;
  render();
}

function setTool(tool) {
  activeTool = tool;
  document.querySelectorAll(".tool-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === tool);
  });
  drawSettings.classList.toggle("hidden", tool !== "draw");
}

function updateSelected(patch) {
  const item = selectedItem();
  if (!item || item.locked) return;
  recordHistory();
  Object.assign(item, patch);
  render();
}

function deleteSelected() {
  if (!selectedIds.size) return;
  const deletableIds = new Set(selectedItems().filter((item) => !item.locked).map((item) => item.id));
  if (!deletableIds.size) return;
  recordHistory();
  state.items = state.items.filter((item) => !deletableIds.has(item.id));
  clearSelection();
  render();
}

function undoDrawPath() {
  undoEditor();
}

function redoDrawPath() {
  redoEditor();
}

function hideContextMenu() {
  contextMenu.classList.add("hidden");
  contextMenu.innerHTML = "";
}

function hideQuickViewMenu() {
  quickViewMenu.classList.add("hidden");
}

function showQuickViewMenu(event) {
  if (!quickViewMenu.innerHTML) {
    quickViewMenu.innerHTML = `
      <div class="quick-view-header">
        <span>Quick View</span>
        <button type="button" data-quick-action="close" aria-label="Close">x</button>
      </div>
      <div class="quick-view-grid">
        <button type="button" data-quick-action="top">Top</button>
        <button type="button" data-quick-action="rift">Rift</button>
        <button type="button" data-quick-action="mid">Mid</button>
        <button type="button" data-quick-action="dragon">Dragon</button>
        <button type="button" data-quick-action="bot">Bot</button>
        <button type="button" data-quick-action="center">Center</button>
        <button type="button" data-quick-action="home">Home</button>
        <button type="button" data-quick-action="zoom-100">100%</button>
        <button type="button" data-quick-action="zoom-700">700%</button>
      </div>
      <div class="quick-view-checks">
        <label><input type="checkbox" data-quick-toggle="grid"><span>Grid</span></label>
        <label><input type="checkbox" data-quick-toggle="sight"><span>Sight</span></label>
        <label><input type="checkbox" data-quick-toggle="ranges"><span>Ranges</span></label>
        <label><input type="checkbox" data-quick-toggle="labels"><span>Labels</span></label>
        <label><input type="checkbox" data-quick-filter="blue"><span>Blue</span></label>
        <label><input type="checkbox" data-quick-filter="red"><span>Red</span></label>
        <label><input type="checkbox" data-quick-filter="neutral"><span>Neutral</span></label>
        <label><input type="checkbox" data-quick-filter="ward"><span>Wards</span></label>
        <label><input type="checkbox" data-quick-filter="minion"><span>Minions</span></label>
        <label><input type="checkbox" data-quick-filter="drawings"><span>Drawings</span></label>
      </div>`;
  }

  syncQuickViewChecks();
  if (quickViewMenu.classList.contains("hidden")) {
    quickViewMenu.style.left = `${event.clientX}px`;
    quickViewMenu.style.top = `${event.clientY}px`;
  }
  quickViewMenu.classList.remove("hidden");
}

function syncQuickViewChecks() {
  const checks = {
    grid: document.querySelector("#toggle-grid").checked,
    sight: document.querySelector("#toggle-sight").checked,
    ranges: document.querySelector("#toggle-ranges").checked,
    labels: document.querySelector("#toggle-labels").checked
  };
  Object.entries(checks).forEach(([key, checked]) => {
    const input = quickViewMenu.querySelector(`[data-quick-toggle="${key}"]`);
    if (input) input.checked = checked;
  });
  Object.entries(filters).forEach(([key, checked]) => {
    const input = quickViewMenu.querySelector(`[data-quick-filter="${key}"]`);
    if (input) input.checked = checked;
  });
}

function setViewToggle(toggle, checked) {
  const bindings = {
    grid: () => {
      document.querySelector("#toggle-grid").checked = checked;
      diagram.classList.toggle("hide-grid", !checked);
    },
    sight: () => {
      document.querySelector("#toggle-sight").checked = checked;
      document.querySelector("#sight-layer").classList.toggle("hidden", !checked);
    },
    ranges: () => {
      document.querySelector("#toggle-ranges").checked = checked;
      diagram.classList.toggle("hide-ranges", !checked);
    },
    labels: () => {
      document.querySelector("#toggle-labels").checked = checked;
      diagram.classList.toggle("hide-labels", !checked);
    }
  };
  bindings[toggle]?.();
}

function runQuickViewAction(action) {
  const preset = zoomPresets[action];
  if (preset) {
    setZoomAtMapPercent(preset.zoom, preset.x, preset.y);
    return;
  }

  if (action === "center") {
    setZoomAtMapPercent(zoom, 50, 50);
  }
  if (action === "home") {
    resetCamera();
  }
  if (action === "zoom-100") {
    setZoomAtMapPercent(100, 50, 50);
  }
  if (action === "zoom-700") {
    setZoomAtMapPercent(700, 50, 50);
  }
}

function showContextMenu(event, actions) {
  contextMenu.innerHTML = "";
  actions.forEach((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      hideContextMenu();
      action.run();
    });
    contextMenu.appendChild(button);
  });

  contextMenu.style.left = `${event.clientX}px`;
  contextMenu.style.top = `${event.clientY}px`;
  contextMenu.classList.remove("hidden");
}

function lerpItemsTo(items, targetPoint) {
  items = items.filter((item) => !item.locked);
  if (!items.length) return;
  recordHistory();

  const center = items.reduce((acc, item) => {
    acc.x += item.x;
    acc.y += item.y;
    return acc;
  }, { x: 0, y: 0 });
  center.x /= items.length;
  center.y /= items.length;

  const starts = items.map((item) => ({ item, x: item.x, y: item.y }));
  const dx = targetPoint.x - center.x;
  const dy = targetPoint.y - center.y;
  const duration = items.length === 1 ? 260 : 180;
  const started = performance.now();

  function frame(now) {
    const t = clamp((now - started) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    starts.forEach((start) => {
      start.item.x = clamp(start.x + dx * eased, 0, 100);
      start.item.y = clamp(start.y + dy * eased, 0, 100);
    });
    render();
    if (t < 1) requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function erasePathAt(point) {
  let nearest = { index: -1, distance: Infinity };

  state.paths.forEach((path, index) => {
    for (let i = 1; i < path.points.length; i += 1) {
      const distance = distanceToSegment(point, path.points[i - 1], path.points[i]);
      if (distance < nearest.distance) nearest = { index, distance };
    }
  });

  if (nearest.index >= 0 && nearest.distance <= 2.2) {
    recordHistory();
    state.paths.splice(nearest.index, 1);
    render();
    return true;
  }

  return false;
}

function applyViewportTransform() {
  const scale = zoom / 100;
  diagram.style.transform = `matrix(${scale}, 0, 0, ${scale}, ${panX}, ${panY})`;
}

function setZoom(nextZoom) {
  setZoomAtMapPercent(nextZoom, 50, 50);
}

function setZoomAtCursor(nextZoom, event) {
  const oldZoom = zoom / 100;
  const next = clamp(Math.round(nextZoom), 25, 1000);
  const newZoom = next / 100;

  if (newZoom === oldZoom) return;

  const rect = diagram.getBoundingClientRect();
  const baseLeft = rect.left - panX;
  const baseTop = rect.top - panY;
  const localX = (event.clientX - rect.left) / oldZoom;
  const localY = (event.clientY - rect.top) / oldZoom;

  zoom = next;
  panX = event.clientX - baseLeft - localX * newZoom;
  panY = event.clientY - baseTop - localY * newZoom;
  applyViewportTransform();
  zoomSlider.value = String(zoom);
  zoomInput.value = String(zoom);
}

function setZoomAtMapPercent(nextZoom, xPercent, yPercent) {
  const next = clamp(Math.round(nextZoom), 25, 1000);
  const newZoom = next / 100;
  const rect = diagram.getBoundingClientRect();
  const baseLeft = rect.left - panX;
  const baseTop = rect.top - panY;
  const wrapRect = canvasWrap.getBoundingClientRect();
  const localX = diagram.offsetWidth * (xPercent / 100);
  const localY = diagram.offsetHeight * (yPercent / 100);
  const targetX = wrapRect.left + wrapRect.width / 2;
  const targetY = wrapRect.top + wrapRect.height / 2;

  zoom = next;
  panX = targetX - baseLeft - localX * newZoom;
  panY = targetY - baseTop - localY * newZoom;
  applyViewportTransform();
  zoomSlider.value = String(zoom);
  zoomInput.value = String(zoom);
}

function centerMapOnItem(item) {
  if (!item) return;
  setZoomAtMapPercent(zoom, item.x, item.y);
}

function resetCamera() {
  zoom = 100;
  panX = 0;
  panY = 0;
  applyViewportTransform();
  zoomSlider.value = String(zoom);
  zoomInput.value = String(zoom);
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function titleFromFilename(filename) {
  return String(filename || "Untitled Rift Diagram").replace(/\.[^/.]+$/, "");
}

function safeFilename(value, fallback = "rift-diagram") {
  const cleaned = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ");
  return cleaned || fallback;
}

function setDocumentTitle(title) {
  currentDocumentTitle = title || "Untitled Rift Diagram";
  documentTitle.textContent = currentDocumentTitle;
}

function normalizeJsonFilename(filename) {
  const trimmed = String(filename || "").trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase().endsWith(".json") ? trimmed : `${trimmed}.json`;
}

function requestSaveFilename(defaultName = "rift-diagram") {
  return normalizeJsonFilename(window.prompt("Save Rift Diagram as:", defaultName));
}

function saveJson(filename = requestSaveFilename()) {
  if (!filename) return false;
  download(filename, JSON.stringify(state, null, 2), "application/json");
  setDocumentTitle(titleFromFilename(filename));
  return true;
}

function resetMap({ record = true } = {}) {
  if (record) recordHistory();
  seedDefaultMap();
}

function resetBlankMap({ record = true } = {}) {
  if (record) recordHistory();
  state = { version: 1, items: [], paths: [] };
  clearSelection();
  setDocumentTitle("Untitled Rift Diagram");
  render();
}

function seedDefaultMap() {
  if (window.DEFAULT_START_STATE) {
    state = normalizeState(cloneState(window.DEFAULT_START_STATE));
    clearSelection();
    setDocumentTitle("Game Start");
    render();
    return;
  }

  const items = [];
  // const add = (type, team, x, y, label) => {
  //   items.push(createItem(type, team, x, y, label ? { label } : {}));
  // };

  // [
  //   [5, 91, 'Top'], [0, 0, 'Jungle'], [0, 0, 'Mid'], [0, 0, 'Bot'], [0, 0, 'Sup']
  // ].forEach(([x, y, p], index) => add("champion", "blue", x, y, `Blue ${p}`));
  // [
  //   [87, 12], [84, 14], [81, 16], [78, 18], [75, 20]
  // ].forEach(([x, y], index) => add("champion", "red", x, y, `Red ${index + 1}`));

  // [
  //   [21, 73], [15, 53], [16, 28], [32, 72], [42, 61], [50, 50], [56, 85], [74, 85], [86, 79]
  // ].forEach(([x, y]) => add("turret", "blue", x, y));
  // [
  //   [79, 27], [85, 47], [84, 72], [68, 28], [58, 39], [50, 50], [44, 15], [26, 15], [14, 21]
  // ].forEach(([x, y]) => add("turret", "red", x, y));

  // [[18, 20], [28, 76], [80, 82]].forEach(([x, y]) => add("inhibitor", "blue", x, y));
  // [[82, 80], [72, 24], [20, 18]].forEach(([x, y]) => add("inhibitor", "red", x, y));

  // [
  //   ["blue-sentinel", 31, 66], ["gromp", 22, 62], ["wolves", 35, 57], ["raptors", 42, 72], ["red-brambleback", 48, 79], ["krugs", 57, 86],
  //   ["blue-sentinel", 69, 34], ["gromp", 78, 38], ["wolves", 65, 43], ["raptors", 58, 28], ["red-brambleback", 52, 21], ["krugs", 43, 14],
  //   ["scuttler", 42, 43], ["scuttler", 58, 57], ["drake-infernal", 70, 62], ["voidgrubs", 31, 38], ["rift-herald", 30, 35], ["baron", 30, 34]
  // ].forEach(([type, x, y]) => add(type, "neutral", x, y));

  // [
  //   ["minion", "blue", 17, 70], ["minion", "blue", 30, 72], ["cannon", "blue", 43, 75],
  //   ["minion", "blue", 38, 62], ["minion", "blue", 45, 55], ["cannon", "blue", 50, 50],
  //   ["minion", "blue", 58, 83], ["minion", "blue", 70, 84], ["cannon", "blue", 80, 82],
  //   ["minion", "red", 83, 30], ["minion", "red", 70, 28], ["cannon", "red", 57, 25],
  //   ["minion", "red", 62, 38], ["minion", "red", 55, 45], ["cannon", "red", 50, 50],
  //   ["minion", "red", 42, 17], ["minion", "red", 30, 16], ["cannon", "red", 20, 18]
  // ].forEach(([type, team, x, y]) => add(type, team, x, y));

  state = { version: 1, items, paths: [] };
  clearSelection();
  setDocumentTitle("Game Start");
  render();
}

function showNewConfirm(mode = "default") {
  pendingNewMode = mode;
  newConfirmModal.classList.remove("hidden");
}

function hideNewConfirm() {
  newConfirmModal.classList.add("hidden");
}

function loadJson(file) {
  const reportError = (message) => {
    window.alert(`Could not load this diagram. ${message}\nYour current diagram has been kept.`);
  };
  const reader = new FileReader();
  reader.onload = () => {
    let nextState;
    try {
      nextState = normalizeState(JSON.parse(String(reader.result)));
    } catch (error) {
      reportError(error instanceof SyntaxError ? "The file is not valid JSON." : error.message);
      return;
    }
    recordHistory();
    state = nextState;
    clearSelection();
    setDocumentTitle(titleFromFilename(file.name));
    render();
  };
  reader.onerror = () => reportError("The file could not be read. Please try again.");
  reader.onabort = () => reportError("Reading the file was canceled.");
  try {
    reader.readAsText(file);
  } catch {
    reportError("The file could not be read. Please try again.");
  }
}
async function exportPng() {
  try {
    const snapshot = DiagramExport.createSnapshot({
      state,
      filters,
      diagramWidth: diagram.clientWidth,
      showSight: !document.querySelector("#sight-layer").classList.contains("hidden"),
      showRanges: !diagram.classList.contains("hide-ranges"),
      showLabels: !diagram.classList.contains("hide-labels"),
      fontFamily: getComputedStyle(diagram).fontFamily,
      filename: `${safeFilename(currentDocumentTitle)}.png`,
      assetFor,
      isItemVisible
    });
    const blob = await DiagramExport.createPng(snapshot);
    const pngUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = pngUrl;
    link.download = snapshot.filename;
    link.click();
    URL.revokeObjectURL(pngUrl);
  } catch (error) {
    console.error(error);
    alert("PNG export failed. Try refreshing the app and exporting again.");
  }
}

document.querySelectorAll(".tool-button").forEach((button) => {
  button.addEventListener("click", () => setTool(button.dataset.tool));
});

document.querySelectorAll(".brush-color").forEach((button) => {
  button.addEventListener("click", () => {
    brushColor = button.dataset.brushColor;
    document.querySelectorAll(".brush-color").forEach((candidate) => {
      candidate.classList.toggle("active", candidate === button);
    });
  });
});

document.querySelectorAll(".palette-item").forEach((button) => {
  button.addEventListener("click", () => addItem(button.dataset.add, button.dataset.team, 50, 50));
  button.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("application/json", JSON.stringify({
      type: button.dataset.add,
      team: button.dataset.team
    }));
    event.dataTransfer.effectAllowed = "copy";
  });
});

diagram.addEventListener("dragover", (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});

diagram.addEventListener("dragstart", (event) => {
  event.preventDefault();
});

diagram.addEventListener("drop", (event) => {
  event.preventDefault();
  const payload = event.dataTransfer.getData("application/json");
  if (!payload) return;
  const item = JSON.parse(payload);
  const point = pointFromEvent(event);
  addItem(item.type, item.team, point.x, point.y);
});

diagram.addEventListener("wheel", (event) => {
  event.preventDefault();
  const direction = event.deltaY > 0 ? -1 : 1;
  const velocity = clamp(Math.abs(event.deltaY) / 8, 8, 85);
  const step = (event.ctrlKey || event.metaKey ? 0.55 : 1) * velocity;
  setZoomAtCursor(zoom + direction * step, event);
}, { passive: false });

diagram.addEventListener("auxclick", (event) => {
  if (event.button === 1) event.preventDefault();
});

diagram.addEventListener("dblclick", (event) => {
  if (event.target.closest(".token")) return;
  event.preventDefault();
  const point = pointFromEvent(event);
  setZoomAtMapPercent(700, point.x, point.y);
});

diagram.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  if (suppressNextContextMenu) {
    suppressNextContextMenu = false;
    hideContextMenu();
    return;
  }

  const token = event.target.closest(".token");
  const point = pointFromEvent(event);

  if (token) {
    const itemId = token.dataset.id;
    const item = state.items.find((candidate) => candidate.id === itemId);
    showContextMenu(event, [
      {
        label: `Select ${item?.label || "item"}`,
        run: () => {
          selectOnly(itemId, { visibleOnly: true });
          render();
        }
      },
      {
        label: selectedIds.has(itemId) ? "Keep in selection" : "Add to selection",
        run: () => {
          addToSelection(itemId);
          render();
        }
      },
      {
        label: "Delete item",
        run: () => {
          selectOnly(itemId, { visibleOnly: true });
          deleteSelected();
        }
      }
    ]);
    return;
  }

  if (selectedIds.size === 1) {
    hideContextMenu();
    lerpItemsTo(selectedItems(), point);
    return;
  }

  const actions = [];
  if (selectedIds.size) {
    actions.push({
      label: selectedIds.size === 1 ? "Move selected here" : `Move ${selectedIds.size} selected here`,
      run: () => lerpItemsTo(selectedItems(), point)
    });
    actions.push({
      label: `Delete ${selectedIds.size} selected`,
      run: deleteSelected
    });
    actions.push({
      label: "Clear selection",
      run: () => {
        clearSelection();
        render();
      }
    });
  } else {
    actions.push({
      label: "Select all items",
      run: () => {
        selectedIds = new Set(state.items.filter((item) => isItemVisible(item)).map((item) => item.id));
        selectedId = selectedItems().at(-1)?.id || null;
        render();
      }
    });
  }

  showContextMenu(event, actions);
});

diagram.addEventListener("pointerdown", (event) => {
  hideContextMenu();

  const token = event.target.closest(".token");

  if (event.button === 1 || event.button === 2) {
    event.preventDefault();
    panDrag = {
      button: event.button,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: panX,
      startPanY: panY,
      moved: false
    };
    diagram.classList.add("panning");
    diagram.setPointerCapture(event.pointerId);
    return;
  }

  if (event.button !== 0) return;
  event.preventDefault();
  diagram.focus({ preventScroll: true });

  if (activeTool === "erase") {
    if (token) {
      if (itemById(token.dataset.id)?.locked) return;
      selectOnly(token.dataset.id, { visibleOnly: true });
      deleteSelected();
      return;
    }
    erasePathAt(pointFromEvent(event));
    return;
  }

  if (activeTool === "draw") {
    recordHistory();
    activePath = { color: brushColor, width: brushWidth, points: [pointFromEvent(event)] };
    state.paths.push(activePath);
    render();
    diagram.setPointerCapture(event.pointerId);
    return;
  }

  if (!token) {
    const point = pointFromEvent(event);
    boxSelect = { start: point, end: point, additive: event.shiftKey };
    if (!event.shiftKey) clearSelection();
    setSelectionBox(point, point);
    selectionBox.classList.remove("hidden");
    render();
    diagram.setPointerCapture(event.pointerId);
    return;
  }

  if (event.shiftKey) {
    addToSelection(token.dataset.id);
  } else if (!selectedIds.has(token.dataset.id)) {
    selectOnly(token.dataset.id, { visibleOnly: true });
  } else {
    selectedId = token.dataset.id;
  }
  if (selectedItems().every((selected) => selected.locked)) {
    render();
    return;
  }
  const point = pointFromEvent(event);
  drag = {
    recorded: false,
    offsets: selectedItems().filter((selected) => !selected.locked).map((selected) => ({
      id: selected.id,
      dx: selected.x - point.x,
      dy: selected.y - point.y
    }))
  };
  diagram.setPointerCapture(event.pointerId);
  render();
});

diagram.addEventListener("pointermove", (event) => {
  if (drag) {
    const point = pointFromEvent(event);
    const changes = drag.offsets.flatMap((offset) => {
      const item = itemById(offset.id);
      if (!item || item.locked) return [];
      const x = clamp(point.x + offset.dx, 0, 100);
      const y = clamp(point.y + offset.dy, 0, 100);
      return Math.abs(item.x - x) > 1e-8 || Math.abs(item.y - y) > 1e-8 ? [{ item, x, y }] : [];
    });
    if (changes.length) {
      if (!drag.recorded) {
        recordHistory();
        drag.recorded = true;
      }
      changes.forEach(({ item, x, y }) => Object.assign(item, { x, y }));
      render();
    }
  }

  if (panDrag) {
    const dx = event.clientX - panDrag.startClientX;
    const dy = event.clientY - panDrag.startClientY;
    if (Math.hypot(dx, dy) > 3) panDrag.moved = true;
    panX = panDrag.startPanX + dx;
    panY = panDrag.startPanY + dy;
    applyViewportTransform();
  }

  if (boxSelect) {
    boxSelect.end = pointFromEvent(event);
    setSelectionBox(boxSelect.start, boxSelect.end);
  }

  if (activePath) {
    activePath.points.push(pointFromEvent(event));
    render();
  }
});

diagram.addEventListener("pointerup", (event) => {
  const completedPan = panDrag;
  if (panDrag?.button === 2 && panDrag.moved) {
    suppressNextContextMenu = true;
  }

  if (boxSelect) {
    const previousIds = new Set(selectedIds);
    selectItemsInBox(boxSelect.start, boxSelect.end);
    if (boxSelect.additive) {
      previousIds.forEach((id) => {
        const item = itemById(id);
        if (item && isItemVisible(item)) selectedIds.add(id);
      });
      selectedId = selectedItems().at(-1)?.id || null;
      render();
    }
    boxSelect = null;
    selectionBox.classList.add("hidden");
  }

  clearPointerInteraction();
  if (diagram.hasPointerCapture(event.pointerId)) diagram.releasePointerCapture(event.pointerId);

  if (completedPan?.button === 1 && !completedPan.moved) {
    event.preventDefault();
    showQuickViewMenu(event);
  }
});

function clearPointerInteraction() {
  drag = null;
  panDrag = null;
  activePath = null;
  boxSelect = null;
  selectionBox.classList.add("hidden");
  diagram.classList.remove("panning");
}

diagram.addEventListener("pointercancel", clearPointerInteraction);
diagram.addEventListener("lostpointercapture", clearPointerInteraction);

layerList.addEventListener("click", (event) => {
  const row = event.target.closest(".layer-row");
  if (!row) return;
  const layerAction = event.target.closest("[data-layer-action]")?.dataset.layerAction;
  if (layerAction === "visibility") {
    toggleLayerVisibility(row.dataset.id);
    return;
  }
  if (layerAction === "lock") {
    toggleLayerLock(row.dataset.id);
    return;
  }
  if (layerAction === "rename") {
    renameLayer(row.dataset.id);
    return;
  }

  const now = performance.now();
  const isDoubleClick = lastLayerClick.id === row.dataset.id && now - lastLayerClick.time < 380;
  lastLayerClick = { id: row.dataset.id, time: now };

  if (event.shiftKey) {
    addToSelection(row.dataset.id);
  } else {
    selectOnly(row.dataset.id);
  }
  render();

  if (isDoubleClick) {
    const item = state.items.find((candidate) => candidate.id === row.dataset.id);
    centerMapOnItem(item);
  }
});

propLabel.addEventListener("input", () => updateSelected({ label: propLabel.value }));
propSize.addEventListener("input", () => updateSelected({ size: Number(propSize.value) }));
propCloaked.addEventListener("change", () => updateSelected({ cloaked: propCloaked.checked }));
propRange.addEventListener("input", () => updateSelected({ range: Number(propRange.value) }));

document.querySelectorAll("[data-team-set]").forEach((button) => {
  button.addEventListener("click", () => {
    const item = selectedItem();
    if (!item) return;
    updateSelected({ team: button.dataset.teamSet });
  });
});

document.querySelector("#duplicate").addEventListener("click", () => {
  duplicateSelection();
});

document.querySelectorAll("[data-selection-action]").forEach((button) => {
  button.addEventListener("click", () => runSelectionAction(button.dataset.selectionAction));
});

document.querySelector("#delete").addEventListener("click", deleteSelected);
document.querySelector("#new-map").addEventListener("click", () => {
  newMenu.classList.toggle("hidden");
});
newMenu.addEventListener("click", (event) => {
  const mode = event.target.closest("[data-new-mode]")?.dataset.newMode;
  if (!mode) return;
  newMenu.classList.add("hidden");
  showNewConfirm(mode);
});
document.querySelector("#save-json").addEventListener("click", () => saveJson());
document.querySelector("#load-json").addEventListener("click", () => fileInput.click());
document.querySelector("#export-png").addEventListener("click", exportPng);
document.querySelector("#new-cancel").addEventListener("click", hideNewConfirm);
document.querySelector("#new-proceed").addEventListener("click", () => {
  hideNewConfirm();
  if (pendingNewMode === "blank") {
    resetBlankMap();
  } else {
    resetMap();
  }
});
document.querySelector("#new-save-proceed").addEventListener("click", () => {
  if (!saveJson()) return;
  hideNewConfirm();
  if (pendingNewMode === "blank") {
    resetBlankMap();
  } else {
    resetMap();
  }
});
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) loadJson(fileInput.files[0]);
  fileInput.value = "";
});

document.querySelector("#toggle-grid").addEventListener("change", (event) => {
  diagram.classList.toggle("hide-grid", !event.target.checked);
});
document.querySelector("#home-view").addEventListener("click", resetCamera);
document.querySelector("#toggle-sight").addEventListener("change", (event) => {
  document.querySelector("#sight-layer").classList.toggle("hidden", !event.target.checked);
});
document.querySelector("#toggle-ranges").addEventListener("change", (event) => {
  diagram.classList.toggle("hide-ranges", !event.target.checked);
});
document.querySelector("#toggle-labels").addEventListener("change", (event) => {
  diagram.classList.toggle("hide-labels", !event.target.checked);
});
document.querySelectorAll("[data-filter]").forEach((input) => {
  input.addEventListener("change", () => {
    setLayerFilter(input.dataset.filter, input.checked);
  });
});

zoomSlider.addEventListener("input", (event) => setZoom(Number(event.target.value)));
zoomInput.addEventListener("change", (event) => setZoom(Number(event.target.value)));
zoomInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") setZoom(Number(event.target.value));
});
brushWidthInput.addEventListener("input", (event) => {
  brushWidth = Number(event.target.value);
});

const zoomPresets = {
  top: { x: 16, y: 16, zoom: 390 },
  rift: { x: 32, y: 30, zoom: 400 },
  mid: { x: 50, y: 50, zoom: 360 },
  dragon: { x: 70, y: 70, zoom: 400 },
  bot: { x: 84, y: 80, zoom: 390 },
};

document.querySelectorAll("[data-zoom-preset]").forEach((button) => {
  button.addEventListener("click", () => {
    const preset = zoomPresets[button.dataset.zoomPreset];
    if (!preset) return;
    setZoomAtMapPercent(preset.zoom, preset.x, preset.y);
  });
});

quickViewMenu.addEventListener("click", (event) => {
  const action = event.target.closest("[data-quick-action]")?.dataset.quickAction;
  if (!action) return;
  if (action === "close") {
    hideQuickViewMenu();
    return;
  }
  runQuickViewAction(action);
});

quickViewMenu.addEventListener("change", (event) => {
  const toggle = event.target.closest("[data-quick-toggle]")?.dataset.quickToggle;
  if (toggle) {
    setViewToggle(toggle, event.target.checked);
    return;
  }

  const filter = event.target.closest("[data-quick-filter]")?.dataset.quickFilter;
  if (filter) {
    setLayerFilter(filter, event.target.checked);
  }
});

quickViewMenu.addEventListener("pointerdown", (event) => {
  const header = event.target.closest(".quick-view-header");
  if (!header || event.target.closest("[data-quick-action='close']")) return;
  event.preventDefault();
  const rect = quickViewMenu.getBoundingClientRect();
  quickViewDrag = {
    dx: event.clientX - rect.left,
    dy: event.clientY - rect.top
  };
  quickViewMenu.setPointerCapture(event.pointerId);
});

quickViewMenu.addEventListener("pointermove", (event) => {
  if (!quickViewDrag) return;
  const maxX = window.innerWidth - quickViewMenu.offsetWidth - 8;
  const maxY = window.innerHeight - quickViewMenu.offsetHeight - 8;
  quickViewMenu.style.left = `${clamp(event.clientX - quickViewDrag.dx, 8, maxX)}px`;
  quickViewMenu.style.top = `${clamp(event.clientY - quickViewDrag.dy, 8, maxY)}px`;
});

quickViewMenu.addEventListener("pointerup", (event) => {
  quickViewDrag = null;
  if (quickViewMenu.hasPointerCapture(event.pointerId)) {
    quickViewMenu.releasePointerCapture(event.pointerId);
  }
});

document.addEventListener("keydown", (event) => {
  const isTextEntry = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);

  if (event.key === "Escape") {
    hideContextMenu();
    hideQuickViewMenu();
    hideNewConfirm();
    if (activeTool !== "select") {
      setTool("select");
    } else {
      clearSelection();
      render();
    }
    return;
  }

  if (!isTextEntry && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) {
      redoEditor();
    } else {
      undoEditor();
    }
    return;
  }

  if (!isTextEntry && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
    event.preventDefault();
    duplicateSelection();
    return;
  }

  if (!isTextEntry && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const key = event.key.toLowerCase();
    if (key === "s") {
      event.preventDefault();
      setTool("select");
      return;
    }
    if (key === "d") {
      event.preventDefault();
      setTool("draw");
      return;
    }
    if (key === "e") {
      event.preventDefault();
      setTool("erase");
      return;
    }
    if (key === "v") {
      event.preventDefault();
      const sightToggle = document.querySelector("#toggle-sight");
      sightToggle.checked = !sightToggle.checked;
      document.querySelector("#sight-layer").classList.toggle("hidden", !sightToggle.checked);
      return;
    }
    if (key === "g") {
      event.preventDefault();
      const gridToggle = document.querySelector("#toggle-grid");
      gridToggle.checked = !gridToggle.checked;
      diagram.classList.toggle("hide-grid", !gridToggle.checked);
      return;
    }
  }

  if (event.key === "Delete" || event.key === "Backspace") {
    if (!isTextEntry) deleteSelected();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveJson();
  }
});

document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".menu-button")) {
    newMenu.classList.add("hidden");
  }
  if (!event.target.closest(".context-menu") && !event.target.closest("#diagram")) {
    hideContextMenu();
  }
});

seedDefaultMap();
undoStack = [];
redoStack = [];
setZoom(100);
