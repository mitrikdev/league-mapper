(function (root) {
  "use strict";

  const FLAGS = Object.freeze({ brush: 1, wall: 2, transparent: 64, alwaysVisible: 256, gate: 4096 });
  const DEFAULT_RADII = Object.freeze({ champion: 1350, clone: 1350, minion: 1200, cannon: 1200, "super-minion": 1350, turret: 1350 });
  const MAX_CACHE = 96;

  // Ordinary, static sight on the supplied terrain snapshot. Ability stealth,
  // attacks/reveal timers, sweepers, Faelights and elemental changes are not simulated.
  // Ward/minion radii: current Riot character data mirrored by CommunityDragon.
  // Farsight is unobstructed (13.10); turret true sight is 1100 (26.1).
  // https://www.leagueoflegends.com/en-gb/news/game-updates/patch-13-10-notes/
  // https://www.leagueoflegends.com/en-sg/news/game-updates/patch-26-1-notes/
  // https://raw.communitydragon.org/latest/game/data/characters/yellowtrinket/yellowtrinket.bin.json
  // https://raw.communitydragon.org/latest/game/data/characters/sru_orderminionmelee/sru_orderminionmelee.bin.json
  // Current champion/turret exports omit sight radius; 1350 is the established
  // ordinary-sight default, separate from attack radius and true-sight detection.
  // This conservative model grants each observer sight only within its own brush
  // component; allied observer masks share that coverage, never unlimited brush.
  function create(terrain) {
    if (!terrain || !Number.isInteger(terrain.width) || !Number.isInteger(terrain.height) ||
        terrain.width < 1 || terrain.height < 1 || !terrain.flags ||
        terrain.flags.length !== terrain.width * terrain.height) {
      throw new Error("Vision terrain must include dimensions and one flag value per cell.");
    }
    const width = terrain.width;
    const height = terrain.height;
    const flags = Uint16Array.from(terrain.flags);
    const bounds = { left: 0, top: 0, width: 100, height: 100, ...terrain.mapBounds };
    const mapUnits = Number.isFinite(terrain.mapUnits) && terrain.mapUnits > 0 ? terrain.mapUnits : 15000;
    if (![bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) {
      throw new Error("Vision terrain map bounds must have positive dimensions.");
    }
    const cellWidth = bounds.width / width;
    const cellHeight = bounds.height / height;
    const brushIds = new Uint32Array(flags.length);
    const masks = new Map();
    let cacheHits = 0;
    let cacheMisses = 0;
    let nextBrush = 0;
    const opaque = (flag) => Boolean((flag & FLAGS.wall) && !(flag & FLAGS.transparent) && !(flag & FLAGS.brush));
    const indexAt = (col, row) => row * width + col;

    // Components prevent vision from jumping between two separate brush patches.
    for (let index = 0; index < flags.length; index++) {
      if (!(flags[index] & FLAGS.brush) || brushIds[index]) continue;
      const queue = [index];
      brushIds[index] = ++nextBrush;
      for (let head = 0; head < queue.length; head++) {
        const current = queue[head], col = current % width, row = Math.floor(current / width);
        const neighbors = [];
        if (col) neighbors.push(current - 1);
        if (col + 1 < width) neighbors.push(current + 1);
        if (row) neighbors.push(current - width);
        if (row + 1 < height) neighbors.push(current + width);
        for (const neighbor of neighbors) {
          if ((flags[neighbor] & FLAGS.brush) && !brushIds[neighbor]) {
            brushIds[neighbor] = nextBrush;
            queue.push(neighbor);
          }
        }
      }
    }

    function point(value) {
      const x = Number(value.x), y = Number(value.y);
      const gx = (x - bounds.left) / cellWidth;
      const gy = (y - bounds.top) / cellHeight;
      const col = Math.floor(gx), row = Math.floor(gy);
      const inBounds = Number.isFinite(x) && Number.isFinite(y) && col >= 0 && row >= 0 && col < width && row < height;
      const index = inBounds ? indexAt(col, row) : -1;
      return { x, y, gx, gy, col, row, index, inBounds, flag: inBounds ? flags[index] : 0,
        brushId: inBounds ? brushIds[index] : 0 };
    }

    function inspect(value) {
      const p = point(value);
      return { x: p.x, y: p.y, column: p.col, row: p.row, flags: p.flag, brushId: p.brushId,
        inBounds: p.inBounds, wall: p.inBounds && opaque(p.flag), brush: Boolean(p.flag & FLAGS.brush),
        gate: Boolean(p.flag & FLAGS.gate) };
    }

    function radius(item) {
      if (Number.isFinite(item.visionRadius)) return Math.max(0, Math.min(2500, item.visionRadius));
      if (item.type === "ward") return item.wardKind === "farsight" ? 500 : 900;
      return DEFAULT_RADII[item.type] || 0;
    }

    // Supercover traversal checks the cells on both sides of a diagonal corner.
    // Brush blocks the area behind it too. An observer within the same connected
    // brush sees out; another allied observer shares that visibility by mask union.
    function lineOfSight(from, to, unobstructed = false, showWallFace = false) {
      if (!from.inBounds || !to.inBounds) return false;
      if (unobstructed) return true;
      let col = from.col, row = from.row;
      let enteredGate = false;
      const beganInGate = Boolean(from.flag & FLAGS.gate);
      function clearCell(x, y, endpoint, advanceGate = true) {
        if (x < 0 || y < 0 || x >= width || y >= height) return false;
        const index = indexAt(x, y), flag = flags[index];
        if (opaque(flag)) return Boolean(endpoint && showWallFace);
        if ((flag & FLAGS.brush) && brushIds[index] !== from.brushId) return false;
        // Side cells touched only at a corner can block geometry, but must not
        // advance gate entry/exit. Only cells traversed by the ray do that.
        if (advanceGate) {
          if (flag & FLAGS.gate) enteredGate = true;
          else if (enteredGate && !beganInGate) return false;
        }
        return true;
      }
      if (opaque(from.flag)) return false;
      const dx = to.gx - from.gx, dy = to.gy - from.gy;
      const stepX = Math.sign(dx), stepY = Math.sign(dy);
      const deltaX = dx === 0 ? Infinity : Math.abs(1 / dx);
      const deltaY = dy === 0 ? Infinity : Math.abs(1 / dy);
      let nextX = dx === 0 ? Infinity : ((stepX > 0 ? col + 1 : col) - from.gx) / dx;
      let nextY = dy === 0 ? Infinity : ((stepY > 0 ? row + 1 : row) - from.gy) / dy;
      if (!clearCell(col, row, col === to.col && row === to.row)) return false;
      for (let steps = 0; col !== to.col || row !== to.row; steps++) {
        if (steps > width + height + 2) return false;
        if (Math.abs(nextX - nextY) < 1e-10) {
          if (!clearCell(col + stepX, row, false, false) || !clearCell(col, row + stepY, false, false)) return false;
          col += stepX; row += stepY; nextX += deltaX; nextY += deltaY;
        } else if (nextX < nextY) {
          col += stepX; nextX += deltaX;
        } else {
          row += stepY; nextY += deltaY;
        }
        if (!clearCell(col, row, col === to.col && row === to.row)) return false;
      }
      return true;
    }

    function within(from, to, sightRadius) {
      const dx = (to.x - from.x) * mapUnits / 100;
      const dy = (to.y - from.y) * mapUnits / 100;
      return dx * dx + dy * dy <= sightRadius * sightRadius + 1e-7;
    }

    function sourceMask(source) {
      const key = `${source.point.x},${source.point.y},${source.radius},${source.unobstructed ? 1 : 0}`;
      if (masks.has(key)) {
        const value = masks.get(key);
        masks.delete(key); masks.set(key, value); cacheHits++;
        return value;
      }
      cacheMisses++;
      const result = [];
      const extent = source.radius / mapUnits * 100;
      const minCol = Math.max(0, Math.floor((source.point.x - extent - bounds.left) / cellWidth));
      const maxCol = Math.min(width - 1, Math.floor((source.point.x + extent - bounds.left) / cellWidth));
      const minRow = Math.max(0, Math.floor((source.point.y - extent - bounds.top) / cellHeight));
      const maxRow = Math.min(height - 1, Math.floor((source.point.y + extent - bounds.top) / cellHeight));
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const target = point({ x: bounds.left + (col + .5) * cellWidth, y: bounds.top + (row + .5) * cellHeight });
          if (within(source.point, target, source.radius) && lineOfSight(source.point, target, source.unobstructed, true)) {
            result.push(indexAt(col, row));
          }
        }
      }
      // A point exactly on a cell edge still reveals its own cell.
      if (!result.includes(source.point.index)) result.push(source.point.index);
      masks.set(key, Uint32Array.from(result));
      if (masks.size > MAX_CACHE) masks.delete(masks.keys().next().value);
      return masks.get(key);
    }

    function fogRectangles(visible) {
      const rects = [];
      let previousRuns = new Map();
      for (let row = 0; row < height; row++) {
        const currentRuns = new Map();
        for (let col = 0; col < width;) {
          if (visible[indexAt(col, row)]) { col++; continue; }
          const start = col;
          while (col < width && !visible[indexAt(col, row)]) col++;
          const key = `${start}:${col}`;
          let rect = previousRuns.get(key);
          if (rect) rect[3] += cellHeight;
          else { rect = [bounds.left + start * cellWidth, bounds.top + row * cellHeight, (col - start) * cellWidth, cellHeight]; rects.push(rect); }
          currentRuns.set(key, rect);
        }
        previousRuns = currentRuns;
      }
      if (bounds.top > 0) rects.push([0, 0, 100, bounds.top]);
      if (bounds.top + bounds.height < 100) rects.push([0, bounds.top + bounds.height, 100, 100 - bounds.top - bounds.height]);
      if (bounds.left > 0) rects.push([0, bounds.top, bounds.left, bounds.height]);
      if (bounds.left + bounds.width < 100) rects.push([bounds.left + bounds.width, bounds.top, 100 - bounds.left - bounds.width, bounds.height]);
      return rects.map(([x, y, w, h]) => {
        const left = Math.max(0, x), top = Math.max(0, y), right = Math.min(100, x + w), bottom = Math.min(100, y + h);
        return [left, top, right - left, bottom - top];
      }).filter((rect) => rect[2] > 0 && rect[3] > 0);
    }

    function compute(items, perspective = "all") {
      if (!["all", "blue", "red"].includes(perspective)) throw new Error("Unknown vision perspective.");
      const activeItems = items.filter((item) => !item.hidden);
      const radiusById = {};
      const disabled = new Set();
      const revealedControls = { blue: new Set(), red: new Set() };
      const blocked = new Set();
      const possible = [];
      for (const item of activeItems) {
        const sightRadius = radius(item);
        if (sightRadius > 0 || Number.isFinite(item.visionRadius)) radiusById[item.id] = sightRadius;
        if (item.type === "ward" && item.visionDisabled) disabled.add(item.id);
        if (!sightRadius || (item.team !== "blue" && item.team !== "red")) continue;
        const p = point(item);
        if (!p.inBounds || opaque(p.flag)) { blocked.add(item.id); continue; }
        if (item.visionDisabled) continue;
        possible.push({ item, point: p, radius: sightRadius, unobstructed: item.type === "ward" && item.wardKind === "farsight" });
      }
      const controls = possible.filter((source) => source.item.type === "ward" && source.item.wardKind === "control");
      // Control wards suppress both stealth and farsight wards, but not one another.
      // Their ordinary line of sight is still required; no detection through walls.
      for (const item of activeItems) {
        if (item.type !== "ward" || item.wardKind === "control" || (item.team !== "blue" && item.team !== "red")) continue;
        const target = point(item);
        for (const source of controls) {
          if (source.item.team !== item.team && within(source.point, target, 900) && lineOfSight(source.point, target)) {
            disabled.add(item.id);
            // A control ward exposes itself to the team whose ward it is jamming.
            revealedControls[item.team].add(source.item.id);
          }
        }
      }
      const sources = possible.filter((source) => !disabled.has(source.item.id) && (perspective === "all" || source.item.team === perspective));
      if (perspective === "all") {
        return { perspective, fogRects: [], visibleIds: activeItems.map((item) => item.id), radiusById,
          mapUnits, sourceCount: sources.length, disabledWardIds: [...disabled], blockedSourceIds: [...blocked] };
      }
      const visible = new Uint8Array(flags.length);
      for (let index = 0; index < flags.length; index++) if (flags[index] & FLAGS.alwaysVisible) visible[index] = 1;
      for (const source of sources) for (const index of sourceMask(source)) visible[index] = 1;
      const detectors = sources.filter((source) => source.item.type === "turret" || (source.item.type === "ward" && source.item.wardKind === "control"));
      const visibleIds = activeItems.filter((item) => {
        if (item.team === perspective || revealedControls[perspective].has(item.id) || item.type === "turret" || item.type === "inhibitor" || item.type === "ping") return true;
        const target = point(item);
        if (item.type === "ward" && item.wardKind !== "control" && item.wardKind !== "farsight") {
          return detectors.some((source) => within(source.point, target, source.item.type === "turret" ? 1100 : 900) && lineOfSight(source.point, target));
        }
        if (target.inBounds && (target.flag & FLAGS.alwaysVisible)) return true;
        return sources.some((source) => within(source.point, target, source.radius) && lineOfSight(source.point, target, source.unobstructed));
      }).map((item) => item.id);
      return { perspective, fogRects: fogRectangles(visible), visibleIds, radiusById,
        mapUnits, sourceCount: sources.length, disabledWardIds: [...disabled], blockedSourceIds: [...blocked] };
    }

    return { compute, inspect, cacheInfo: () => ({ size: masks.size, maxSize: MAX_CACHE, hits: cacheHits, misses: cacheMisses }) };
  }

  const api = { create };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VisionEngine = api;
})(globalThis);
