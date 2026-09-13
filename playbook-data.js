(function (root) {
  "use strict";

  const MAX_SCENES = 30;
  const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

  function invalid(field, requirement) {
    throw new Error(`${field} ${requirement}.`);
  }

  function record(value, field) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      invalid(field, "must be an object");
    }
    return value;
  }

  function text(value, field, limit) {
    if (typeof value !== "string" || value.length > limit) {
      invalid(field, `must be text of at most ${limit} characters`);
    }
    return value;
  }

  function identifier(value, field) {
    if (typeof value !== "string" || !identifierPattern.test(value)) {
      invalid(field, "must be a nonempty ID containing only letters, numbers, underscores or hyphens (up to 128 characters)");
    }
    return value;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function sceneId(existing = []) {
    let uuid;
    if (root.crypto && typeof root.crypto.randomUUID === "function") {
      uuid = root.crypto.randomUUID();
    } else if (typeof require === "function") {
      uuid = require("node:crypto").randomUUID();
    } else if (root.crypto && typeof root.crypto.getRandomValues === "function") {
      const bytes = root.crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      uuid = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    } else {
      throw new Error("This browser cannot create secure scene IDs.");
    }
    const base = `scene-${uuid}`;
    const ids = new Set(existing.map((scene) => scene.id));
    let id = base;
    let suffix = 2;
    while (ids.has(id)) id = `${base}-${suffix++}`;
    return id;
  }

  // Callers pass editor diagrams that have already been validated. Clone them
  // here so each scene owns its items, paths and nested path points.
  function create(diagram, title = "Untitled play") {
    const id = sceneId();
    return {
      version: 2,
      title: text(title, "Play title", 120),
      activeSceneId: id,
      scenes: [{ id, title: "Setup", note: "", diagram: clone(diagram) }]
    };
  }

  // Import validates every scene before the caller changes its editor state.
  // Diagram rules stay with DiagramData; this module only owns the playbook.
  function normalize(raw, normalizeDiagram, fallbackTitle = "Untitled play") {
    record(raw, "Playbook");
    if (typeof normalizeDiagram !== "function") {
      throw new Error("A diagram validation function is required.");
    }
    if (raw.version === 1) {
      return create(normalizeDiagram(clone(raw)), fallbackTitle);
    }
    if (raw.version !== 2) invalid("Playbook version", "must be 1 or 2");
    const title = text(raw.title, "Play title", 120);
    if (!Array.isArray(raw.scenes) || raw.scenes.length < 1 || raw.scenes.length > MAX_SCENES) {
      invalid("Playbook scenes", `must contain between 1 and ${MAX_SCENES} scenes`);
    }
    const ids = new Set();
    const scenes = raw.scenes.map((rawScene, index) => {
      const field = `Scene ${index + 1}`;
      const scene = record(rawScene, field);
      const id = identifier(scene.id, `${field} ID`);
      if (ids.has(id)) invalid(`${field} ID`, "must be unique");
      ids.add(id);
      const sceneTitle = text(scene.title, `${field} title`, 80);
      const note = text(scene.note, `${field} note`, 2000);
      const diagram = clone(normalizeDiagram(clone(scene.diagram)));
      return { id, title: sceneTitle, note, diagram };
    });
    const activeSceneId = identifier(raw.activeSceneId, "Active scene ID");
    if (!ids.has(activeSceneId)) invalid("Active scene ID", "must identify an existing scene");
    return { version: 2, title, activeSceneId, scenes };
  }

  function active(book) {
    const scene = book.scenes.find((entry) => entry.id === book.activeSceneId);
    if (!scene) throw new Error("The active scene does not exist.");
    return scene;
  }

  function capture(book, diagram, title) {
    const next = clone(book);
    active(next).diagram = clone(diagram);
    if (title !== undefined) next.title = text(title, "Play title", 120);
    return next;
  }

  function insertScene(book, diagram, duplicate) {
    if (book.scenes.length >= MAX_SCENES) {
      invalid("Playbook", `cannot contain more than ${MAX_SCENES} scenes`);
    }
    const next = capture(book, diagram);
    const source = active(next);
    const index = next.scenes.indexOf(source);
    const id = sceneId(next.scenes);
    next.scenes.splice(index + 1, 0, {
      id,
      title: duplicate ? `${source.title.slice(0, 75)} copy` : `Step ${next.scenes.length + 1}`,
      note: duplicate ? source.note : "",
      diagram: clone(source.diagram)
    });
    next.activeSceneId = id;
    return next;
  }

  function addScene(book, diagram) {
    return insertScene(book, diagram, false);
  }

  function duplicateScene(book, diagram) {
    return insertScene(book, diagram, true);
  }

  function removeScene(book, diagram) {
    if (book.scenes.length <= 1) throw new Error("Keep at least one scene in the playbook.");
    const next = capture(book, diagram);
    const index = next.scenes.indexOf(active(next));
    next.scenes.splice(index, 1);
    next.activeSceneId = next.scenes[Math.max(0, index - 1)].id;
    return next;
  }

  function moveScene(book, diagram, direction) {
    if (direction !== -1 && direction !== 1) {
      throw new Error("Scene direction must be -1 or 1.");
    }
    const next = capture(book, diagram);
    const index = next.scenes.indexOf(active(next));
    const destination = index + direction;
    if (destination >= 0 && destination < next.scenes.length) {
      const [scene] = next.scenes.splice(index, 1);
      next.scenes.splice(destination, 0, scene);
    }
    return next;
  }

  const api = { normalize, create, active, capture, addScene, duplicateScene, removeScene, moveScene };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PlaybookData = api;
})(globalThis);
