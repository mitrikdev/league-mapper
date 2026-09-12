// Editor snapshots and undo/redo. Loaded before app.js as a classic script.
function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

function selectionSnapshot() {
  return {
    selectedId,
    selectedIds: [...selectedIds]
  };
}

function restoreSelection(snapshot) {
  const visibleIds = new Set(state.items.filter((item) => isItemVisible(item)).map((item) => item.id));
  selectedIds = new Set((snapshot?.selectedIds || []).filter((id) => visibleIds.has(id)));
  selectedId = selectedIds.has(snapshot?.selectedId) ? snapshot.selectedId : selectedItems().at(-1)?.id || null;
}

function snapshotEditor() {
  return {
    state: cloneState(state),
    title: currentDocumentTitle,
    selection: selectionSnapshot()
  };
}

function restoreEditor(snapshot) {
  isRestoringHistory = true;
  try {
    state = normalizeState(cloneState(snapshot.state));
    restoreSelection(snapshot.selection);
    setDocumentTitle(snapshot.title || "Untitled Rift Diagram");
    render();
  } finally {
    isRestoringHistory = false;
  }
}

function recordHistory() {
  if (isRestoringHistory) return;
  undoStack.push(snapshotEditor());
  redoStack = [];
}

function undoEditor() {
  if (!undoStack.length) return;
  redoStack.push(snapshotEditor());
  restoreEditor(undoStack.pop());
}

function redoEditor() {
  if (!redoStack.length) return;
  undoStack.push(snapshotEditor());
  restoreEditor(redoStack.pop());
}
