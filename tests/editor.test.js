const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEditor } = require('./helpers/editor-harness.cjs');

function setupUndo() {
  const editor = loadEditor();
  editor.run('addItem("ward", "blue", 50, 50); addItem("champion", "red", 65, 65); undoEditor();');
  return editor;
}

test('clicking a token without moving preserves redo and creates no undo entry', () => {
  const editor = setupUndo();
  const before = editor.result('({ undo: undoStack.length, redo: redoStack.length })');
  editor.pointer('pointerdown', { id: editor.run('state.items[0].id') });
  editor.pointer('pointerup');
  assert.deepEqual(editor.result('({ undo: undoStack.length, redo: redoStack.length })'), before);
  editor.run('redoEditor()');
  assert.equal(editor.run('state.items.length'), 2);
});

test('stationary pointer events preserve redo, while a drag records exactly one reversible action', () => {
  const editor = setupUndo();
  const before = editor.run('undoStack.length');
  editor.pointer('pointerdown', { id: editor.run('state.items[0].id') });
  editor.pointer('pointermove');
  assert.equal(editor.run('redoStack.length'), 1);
  editor.pointer('pointermove', { clientX: 600, clientY: 600 });
  editor.pointer('pointermove', { clientX: 700, clientY: 700 });
  editor.pointer('pointerup');
  assert.equal(editor.run('undoStack.length'), before + 1);
  assert.equal(editor.run('redoStack.length'), 0);
  editor.run('undoEditor()');
  assert.deepEqual(editor.result('[state.items[0].x, state.items[0].y]'), [50, 50]);
  editor.run('redoEditor()');
  assert.deepEqual(editor.result('[state.items[0].x, state.items[0].y]'), [70, 70]);
});

test('box selection excludes filtered teams, wards, all minion variants, hidden and locked items', () => {
  const editor = loadEditor();
  editor.run('state.items = [createItem("champion","blue",50,50), createItem("champion","red",50,50), createItem("ward","blue",50,50), ...["minion","cannon","super-minion"].map(type => createItem(type,"blue",50,50)), createItem("champion","blue",50,50,{hidden:true}), createItem("champion","blue",50,50,{locked:true})]; filters.red=false; filters.ward=false; filters.minion=false; selectItemsInBox({x:0,y:0},{x:100,y:100});');
  assert.deepEqual(editor.result('selectedItems().map(item => [item.type,item.team])'), [['champion','blue']]);
  editor.run('deleteSelected()');
  assert.equal(editor.run('state.items.length'), 7);
});

test('changing a filter removes invisible items from an existing selection', () => {
  const editor = loadEditor();
  editor.run('addItem("champion","blue"); addItem("champion","red"); selectedIds=new Set(state.items.map(item=>item.id)); setLayerFilter("red",false);');
  assert.deepEqual(editor.result('selectedItems().map(item=>item.team)'), ['blue']);
  assert.equal(editor.run('selectedItem().team'), 'blue');
  editor.run('deleteSelected()');
  assert.deepEqual(editor.result('state.items.map(item=>item.team)'), ['red']);
});

test('canvas group selection does not pull filtered group members into the selection', () => {
  const editor = loadEditor();
  editor.run('state.items=[createItem("champion","blue",50,50,{groupId:"group-a"}),createItem("champion","red",50,50,{groupId:"group-a"})]; filters.red=false; selectOnly(state.items[0].id,{visibleOnly:true});');
  assert.deepEqual(editor.result('selectedItems().map(item=>item.team)'), ['blue']);
});

test('additive box selection does not retain invisible items selected through the layer list', () => {
  const editor = loadEditor();
  editor.run('state.items=[createItem("champion","blue",50,50),createItem("champion","red",50,50)]; filters.red=false; selectOnly(state.items[1].id);');
  editor.pointer('pointerdown', { clientX: 0, clientY: 0, shiftKey: true });
  editor.pointer('pointermove', { clientX: 1000, clientY: 1000 });
  editor.pointer('pointerup');
  assert.deepEqual(editor.result('selectedItems().map(item=>item.team)'), ['blue']);
});

test('pointer cancellation ends the drag so later pointer movement cannot change items', () => {
  const editor = loadEditor();
  editor.run('addItem("champion","blue",50,50)');
  editor.pointer('pointerdown', { id: editor.run('state.items[0].id') });
  editor.pointer('pointercancel');
  editor.pointer('pointermove', { clientX: 900, clientY: 900 });
  assert.deepEqual(editor.result('[state.items[0].x,state.items[0].y]'), [50,50]);
  assert.equal(editor.run('drag'), null);
});

test('undo and redo restore the document title along with its content', () => {
  const editor = loadEditor();
  editor.run('setDocumentTitle("Original"); recordHistory(); state.items=[createItem("ward","blue",50,50)]; setDocumentTitle("Imported"); undoEditor();');
  assert.equal(editor.run('currentDocumentTitle'), 'Original');
  assert.equal(editor.run('state.items.length'), 0);
  editor.run('redoEditor()');
  assert.equal(editor.run('currentDocumentTitle'), 'Imported');
  assert.equal(editor.run('state.items.length'), 1);
});


test('undo and redo respect current filters when restoring a selection', () => {
  const editor = loadEditor();
  editor.run('addItem("champion","red",50,50); updateSelected({x:60}); setLayerFilter("red",false); undoEditor();');
  assert.equal(editor.run('selectedIds.size'), 0);
  assert.equal(editor.run('selectedId'), null);
  editor.run('deleteSelected(); redoEditor();');
  assert.equal(editor.run('state.items.length'), 1);
  assert.equal(editor.run('state.items[0].x'), 60);
  assert.equal(editor.run('selectedIds.size'), 0);
});
