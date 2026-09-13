(function (root) {
  "use strict";

  const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
  const colorPattern = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  const teams = new Set(["blue", "red", "neutral"]);
  const roles = new Set(["TOP", "JGL", "MID", "BOT", "SUP"]);
  const wardKinds = new Set(["stealth", "control", "farsight"]);
  const perspectives = new Set(["all", "blue", "red"]);

  function invalid(field, requirement) {
    throw new Error(`${field} ${requirement}.`);
  }

  function record(value, field) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      invalid(field, "must be an object");
    }
    return value;
  }

  function number(value, field, min, max) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      invalid(field, `must be a number between ${min} and ${max}`);
    }
    return value;
  }

  function identifier(value, field) {
    if (typeof value !== "string" || !identifierPattern.test(value)) {
      invalid(field, "must be a nonempty ID containing only letters, numbers, underscores or hyphens (up to 128 characters)");
    }
    return value;
  }

  function optionalBoolean(value, field) {
    if (value === undefined) return false;
    if (typeof value !== "boolean") invalid(field, "must be true or false");
    return value;
  }

  // Validate into a fresh object before the editor changes state or history.
  // Item types come from the editor's templates, so validation stays in sync
  // when a supported token is added. Unknown properties are not imported.
  function normalizeState(value, itemTypes) {
    record(value, "Diagram");
    if (value.version !== 1) invalid("Diagram version", "must be 1");
    if (!Array.isArray(value.items)) invalid("Diagram items", "must be an array");
    if (!Array.isArray(value.paths)) invalid("Diagram paths", "must be an array");
    const supportedTypes = new Set(itemTypes);
    const itemIds = new Set();

    const items = value.items.map((rawItem, index) => {
      const field = `Item ${index + 1}`;
      const item = record(rawItem, field);
      const itemId = identifier(item.id, `${field} ID`);
      if (itemIds.has(itemId)) invalid(`${field} ID`, "must be unique");
      itemIds.add(itemId);
      if (!supportedTypes.has(item.type)) invalid(`${field} type`, "is not supported");
      if (!teams.has(item.team)) invalid(`${field} team`, "must be blue, red or neutral");
      if (typeof item.label !== "string") invalid(`${field} label`, "must be text");
      if (item.role !== undefined && !roles.has(item.role)) {
        invalid(`${field} role`, "must be TOP, JGL, MID, BOT or SUP");
      }

      if (item.wardKind !== undefined && (item.type !== "ward" || !wardKinds.has(item.wardKind))) {
        invalid(field + " ward kind", "must be stealth, control or farsight on a ward");
      }
      if (item.visionDisabled !== undefined && typeof item.visionDisabled !== "boolean") {
        invalid(field + " vision disabled", "must be true or false");
      }

      return {
        id: itemId,
        type: item.type,
        team: item.team,
        x: number(item.x, `${field} x`, 0, 100),
        y: number(item.y, `${field} y`, 0, 100),
        size: number(item.size, `${field} size`, 1, 8),
        range: number(item.range, `${field} range`, 0, 220),
        opacity: number(item.opacity, `${field} opacity`, 0, 100),
        label: item.label,
        ...(item.role === undefined ? {} : { role: item.role }),
        ...(item.wardKind === undefined ? {} : { wardKind: item.wardKind }),
        ...(item.visionDisabled === undefined ? {} : { visionDisabled: item.visionDisabled }),
        ...(item.visionRadius === undefined ? {} : { visionRadius: number(item.visionRadius, field + " vision radius", 0, 2500) }),
        hidden: optionalBoolean(item.hidden, `${field} hidden`),
        locked: optionalBoolean(item.locked, `${field} locked`),
        cloaked: optionalBoolean(item.cloaked, `${field} cloaked`),
        groupId: item.groupId == null ? null : identifier(item.groupId, `${field} group ID`)
      };
    });

    const paths = value.paths.map((rawPath, index) => {
      const field = `Path ${index + 1}`;
      const path = record(rawPath, field);
      if (!Array.isArray(path.points)) invalid(`${field} points`, "must be an array");
      const color = path.color === undefined ? "#f0d66a" : path.color;
      if (typeof color !== "string" || !colorPattern.test(color)) {
        invalid(`${field} color`, "must be a hexadecimal color");
      }
      if (path.arrow !== undefined && typeof path.arrow !== "boolean") {
        invalid(`${field} arrow`, "must be true or false");
      }
      return {
        color,
        ...(path.arrow === undefined ? {} : { arrow: path.arrow }),
        width: number(path.width === undefined ? 7 : path.width, `${field} width`, 1, 7),
        points: path.points.map((rawPoint, pointIndex) => {
          const pointField = `${field} point ${pointIndex + 1}`;
          const point = record(rawPoint, pointField);
          return {
            x: number(point.x, `${pointField} x`, 0, 100),
            y: number(point.y, `${pointField} y`, 0, 100)
          };
        })
      };
    });

    let vision;
    if (value.vision !== undefined) {
      const rawVision = record(value.vision, "Diagram vision");
      if (!perspectives.has(rawVision.perspective)) {
        invalid("Diagram vision perspective", "must be all, blue or red");
      }
      vision = { perspective: rawVision.perspective };
    }

    return { version: 1, items, paths, ...(vision === undefined ? {} : { vision }) };
  }

  const api = { normalizeState };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DiagramData = api;
})(globalThis);
