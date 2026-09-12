const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

function loadEditor() {
  const elements = new Map();
  let document;
  function element(tagName = 'div') {
    const classes = new Set();
    return {
      tagName: tagName.toUpperCase(), dataset: {}, children: [], handlers: {},
      value: '', checked: true, innerHTML: '', textContent: '',
      offsetWidth: 800, offsetHeight: 800, clientWidth: 800,
      style: { setProperty() {} },
      classList: {
        add(...names) { names.forEach(name => classes.add(name)); },
        remove(...names) { names.forEach(name => classes.delete(name)); },
        contains(name) { return classes.has(name); },
        toggle(name, value = !classes.has(name)) { value ? classes.add(name) : classes.delete(name); return value; }
      },
      addEventListener(name, handler) { (this.handlers[name] ||= []).push(handler); },
      appendChild(child) { this.children.push(child); return child; },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute() {}, querySelector() { return null; }, querySelectorAll() { return []; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 1000 }; },
      focus() { document.activeElement = this; },
      setPointerCapture() {}, hasPointerCapture() { return false; }, releasePointerCapture() {}
    };
  }
  document = {
    body: element('body'), activeElement: null, handlers: {},
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    },
    querySelectorAll() { return []; }, createElement: element,
    createElementNS(namespace, tagName) { return element(tagName); },
    addEventListener(name, handler) { (this.handlers[name] ||= []).push(handler); }
  };
  const context = vm.createContext({
    document, window: { DEFAULT_START_STATE: { version: 1, items: [], paths: [] } },
    crypto: { randomUUID }, performance: { now: () => 0 }, console,
    requestAnimationFrame() {}, setTimeout, clearTimeout, alert() {}
  });
  const root = path.resolve(__dirname, '../..');
  for (const name of ['diagram-data.js', 'diagram-history.js', 'diagram-export.js', 'app.js']) {
    if (fs.existsSync(path.join(root, name))) vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), context, { filename: name });
  }
  // These tests exercise application state and actual event handlers; browser checks cover rendering.
  vm.runInContext('render = function() {};', context);
  function run(script) { return vm.runInContext(script, context); }
  function result(script) { return JSON.parse(run('JSON.stringify(' + script + ')')); }
  function pointer(type, options = {}) {
    const token = options.id ? { dataset: { id: options.id }, closest: selector => selector === '.token' ? token : null } : null;
    const event = { button: 0, pointerId: 1, clientX: 500, clientY: 500, shiftKey: false,
      target: token || { closest: () => null }, preventDefault() {}, ...options };
    for (const handler of elements.get('#diagram').handlers[type] || []) handler(event);
  }
  return { run, result, pointer, context, document };
}

module.exports = { loadEditor };
