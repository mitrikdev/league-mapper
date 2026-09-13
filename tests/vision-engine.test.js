const assert = require("node:assert/strict");
const { test } = require("node:test");
const VisionEngine = require("../vision-engine.js");

function terrain(width = 150, height = 150) {
  return { width, height, flags: new Uint16Array(width * height), mapUnits: 15000,
    mapBounds: { left: 0, top: 0, width: 100, height: 100 } };
}
function paint(map, left, top, right, bottom, flag) {
  for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) map.flags[row * map.width + col] = flag;
  return map;
}
function token(id, type = "champion", team = "blue", x = 20, y = 20, extra = {}) {
  return { id, type, team, x, y, ...extra };
}
const seen = (result, id) => result.visibleIds.includes(id);
const area = (result) => result.fogRects.reduce((sum, rect) => sum + rect[2] * rect[3], 0);
const at = (col, row) => ({ x: (col + .5) * 100 / 150, y: (row + .5) * 100 / 150 });
function piece(id, col, row, extra = {}) { return { ...token(id), ...at(col, row), ...extra }; }

// Visibility of tokens is tested at the exact point, not the fog tile centre.
test("sight uses exact inclusive centre range and ignores visual token size/range", () => {
  const engine = VisionEngine.create(terrain());
  const observer = token("observer", "ward", "blue", 20, 20, { range: 220, size: 8 });
  const boundary = token("boundary", "champion", "red", 26, 20);
  const outside = token("outside", "champion", "red", 26.001, 20);
  const result = engine.compute([observer, boundary, outside], "blue");
  assert.equal(result.radiusById.observer, 900);
  assert.equal(seen(result, "boundary"), true);
  assert.equal(seen(result, "outside"), false);
  assert.equal(result.sourceCount, 1);
  assert.equal(result.mapUnits, 15000);
});

test("ordinary radius defaults, zero override, hidden and disabled source rules", () => {
  const engine = VisionEngine.create(terrain());
  const items = ["champion", "clone", "minion", "cannon", "super-minion", "turret", "inhibitor", "pet", "ping", "dragon"].map((type) => token(type, type));
  items.push(token("zero", "champion", "blue", 10, 10, { visionRadius: 0 }));
  items.push(token("custom", "pet", "blue", 10, 10, { visionRadius: 750 }));
  items.push(token("hidden", "ward", "blue", 10, 10, { hidden: true }));
  items.push(token("disabled", "ward", "blue", 10, 10, { visionDisabled: true }));
  const result = engine.compute(items, "blue");
  assert.deepEqual(Object.fromEntries(items.slice(0, 10).map((item) => [item.id, result.radiusById[item.id]])), {
    champion: 1350, clone: 1350, minion: 1200, cannon: 1200, "super-minion": 1350, turret: 1350, inhibitor: undefined, pet: undefined, ping: undefined, dragon: undefined
  });
  assert.equal(result.sourceCount, 7);
  assert.equal(result.radiusById.zero, 0);
  assert.equal(result.radiusById.custom, 750);
  assert.equal(result.radiusById.disabled, 900);
  assert.equal(seen(result, "hidden"), false);
  assert.equal(seen(result, "disabled"), true, "allies remain known even without sight");
  assert.deepEqual(result.disabledWardIds, ["disabled"]);
});

test("opaque walls stop ordinary sight while transparent structure walls do not", () => {
  const map = paint(terrain(), 35, 20, 35, 50, 2);
  const observer = piece("observer", 30, 30);
  const enemy = piece("enemy", 39, 30, { team: "red" });
  assert.equal(seen(VisionEngine.create(map).compute([observer, enemy], "blue"), "enemy"), false);
  paint(map, 35, 20, 35, 50, 2 | 64);
  assert.equal(seen(VisionEngine.create(map).compute([observer, enemy], "blue"), "enemy"), true);
  paint(map, 35, 20, 35, 50, 4);
  assert.equal(seen(VisionEngine.create(map).compute([observer, enemy], "blue"), "enemy"), true);
});

test("sources inside opaque walls or beyond the mapped grid grant no sight", () => {
  const map = paint(terrain(), 30, 30, 30, 30, 2);
  const engine = VisionEngine.create(map);
  const result = engine.compute([piece("wall", 30, 30), token("outside", "ward", "blue", -1, 5), piece("enemy", 31, 30, { team: "red" })], "blue");
  assert.deepEqual(result.blockedSourceIds, ["wall", "outside"]);
  assert.equal(result.sourceCount, 0);
  assert.equal(seen(result, "wall"), true);
  assert.equal(seen(result, "enemy"), false);
  assert.ok(Math.abs(area(result) - 10000) < 1e-6);
});

test("brush obscures its contents and area behind it to outside observers", () => {
  const map = paint(terrain(), 34, 25, 36, 35, 1);
  const engine = VisionEngine.create(map);
  const observer = piece("observer", 30, 30);
  const inBrush = piece("brush", 35, 30, { team: "red" });
  const behind = piece("behind", 39, 30, { team: "red" });
  const result = engine.compute([observer, inBrush, behind], "blue");
  assert.equal(seen(result, "brush"), false);
  assert.equal(seen(result, "behind"), false);
});

test("observers see within their own connected brush and out, not into another brush", () => {
  const map = paint(terrain(), 30, 25, 34, 35, 1);
  paint(map, 38, 25, 40, 35, 1);
  const engine = VisionEngine.create(map);
  const observer = piece("observer", 31, 30);
  const same = piece("same", 33, 30, { team: "red" });
  const out = piece("out", 36, 30, { team: "red" });
  const other = piece("other", 39, 30, { team: "red" });
  const result = engine.compute([observer, same, out, other], "blue");
  assert.equal(seen(result, "same"), true);
  assert.equal(seen(result, "out"), true);
  assert.equal(seen(result, "other"), false);
  assert.equal(engine.inspect(at(31, 30)).brushId, engine.inspect(at(33, 30)).brushId);
  assert.notEqual(engine.inspect(at(31, 30)).brushId, engine.inspect(at(39, 30)).brushId);
});

test("allied ward vision is shared without extending infinitely along a brush", () => {
  const map = paint(terrain(), 34, 20, 60, 35, 1);
  const engine = VisionEngine.create(map);
  const items = [piece("observer", 30, 30), piece("ward", 35, 30, { type: "ward" }),
    piece("near", 40, 30, { team: "red" }), piece("far", 48, 30, { team: "red" })];
  const result = engine.compute(items, "blue");
  assert.equal(seen(result, "near"), true);
  assert.equal(seen(result, "far"), false);
  items[1].visionDisabled = true;
  assert.equal(seen(engine.compute(items, "blue"), "near"), false);
});

test("base gates permit axial and diagonal sight into/out but not through", () => {
  const map = paint(terrain(), 34, 25, 36, 40, 4096 | 1024);
  const engine = VisionEngine.create(map);
  for (const diagonal of [false, true]) {
    const outside = piece("observer", 30, 30);
    const inside = piece("inside", 35, diagonal ? 35 : 30, { team: "red" });
    const beyond = piece("beyond", 40, diagonal ? 40 : 30, { team: "red" });
    const approaching = engine.compute([outside, inside, beyond], "blue");
    assert.equal(seen(approaching, "inside"), true, diagonal ? "diagonal entry" : "axial entry");
    assert.equal(seen(approaching, "beyond"), false, diagonal ? "diagonal through" : "axial through");
    Object.assign(outside, at(35, diagonal ? 35 : 30));
    assert.equal(seen(engine.compute([outside, beyond], "blue"), "beyond"), true,
      diagonal ? "diagonal exit" : "axial exit");
  }
});

test("farsight bypasses walls and brush but retains its 500-unit radius", () => {
  const map = paint(terrain(), 32, 20, 32, 40, 2);
  paint(map, 34, 20, 34, 40, 1);
  const items = [piece("ward", 30, 30, { type: "ward", wardKind: "farsight" }),
    piece("seen", 35, 30, { team: "red" }), piece("far", 36, 30, { team: "red" })];
  const result = VisionEngine.create(map).compute(items, "blue");
  assert.equal(result.radiusById.ward, 500);
  assert.equal(seen(result, "seen"), true);
  assert.equal(seen(result, "far"), false);
});

test("control wards reveal/suppress opposing stealth and farsight, not control wards", () => {
  const engine = VisionEngine.create(terrain());
  const items = [piece("blue-control", 30, 30, { type: "ward", wardKind: "control" }),
    piece("red-stealth", 33, 30, { type: "ward", team: "red" }),
    piece("red-farsight", 35, 30, { type: "ward", team: "red", wardKind: "farsight" }),
    piece("red-control", 37, 30, { type: "ward", team: "red", wardKind: "control" })];
  const result = engine.compute(items, "blue");
  assert.deepEqual(result.disabledWardIds, ["red-stealth", "red-farsight"]);
  assert.equal(seen(result, "red-stealth"), true);
  assert.equal(seen(result, "red-control"), true);
  assert.equal(engine.compute(items, "red").sourceCount, 1);
});

test("control denial and stealth-ward detection respect wall and brush sight", () => {
  for (const flag of [2, 1]) {
    const map = paint(terrain(), 34, 25, 35, 35, flag);
    const items = [piece("control", 30, 30, { type: "ward", wardKind: "control" }),
      piece("enemy", 37, 30, { type: "ward", team: "red" })];
    const result = VisionEngine.create(map).compute(items, "blue");
    assert.deepEqual(result.disabledWardIds, []);
    assert.equal(seen(result, "enemy"), false);
  }
});

test("ordinary sight cannot reveal enemy stealth wards; turret detection stops at1100", () => {
  const engine = VisionEngine.create(terrain());
  const observer = piece("observer", 30, 30);
  const ward = piece("ward", 35, 30, { type: "ward", team: "red" });
  assert.equal(seen(engine.compute([observer, ward], "blue"), "ward"), false);
  observer.type = "turret";
  Object.assign(ward, at(41, 30));
  assert.equal(seen(engine.compute([observer, ward], "blue"), "ward"), true);
  ward.x += .001;
  assert.equal(seen(engine.compute([observer, ward], "blue"), "ward"), false);
  ward.wardKind = "control";
  assert.equal(seen(engine.compute([observer, ward], "blue"), "ward"), true);
});

test("neutral pieces never supply team vision; known structures and annotations remain", () => {
  const engine = VisionEngine.create(terrain());
  const items = [token("neutral", "dragon", "neutral", 20, 20, { visionRadius: 2500 }), token("enemy", "champion", "red", 21, 20),
    token("structure", "turret", "red", 80, 80), token("inhibitor", "inhibitor", "red", 80, 80), token("annotation", "ping", "neutral", 70, 70)];
  const result = engine.compute(items, "blue");
  assert.equal(result.sourceCount, 0);
  assert.deepEqual(result.visibleIds, ["structure", "inhibitor", "annotation"]);
  assert.ok(Math.abs(area(result) - 10000) < 1e-6);
  const all = engine.compute(items);
  assert.equal(all.visibleIds.length, 5);
  assert.deepEqual(all.fogRects, []);
});

test("fog is unioned, merged into bounded rectangles and cached without sharing outputs", () => {
  const engine = VisionEngine.create(terrain());
  const items = [piece("a", 30, 30), piece("b", 37, 30)];
  const first = engine.compute(items, "blue");
  const one = engine.compute(items.slice(0, 1), "blue");
  assert.ok(area(first) < area(one));
  assert.ok(first.fogRects.length < 150, "identical horizontal runs merge vertically");
  for (const [x, y, w, h] of first.fogRects) {
    assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 100 + 1e-8 && y + h <= 100 + 1e-8);
  }
  const before = engine.cacheInfo();
  const repeated = engine.compute(items, "blue");
  assert.deepEqual(repeated, first);
  assert.ok(engine.cacheInfo().hits > before.hits);
  repeated.fogRects[0][2] = -1;
  repeated.visibleIds.length = 0;
  assert.deepEqual(engine.compute(items, "blue"), first);
  for (let index = 0; index < 110; index++) engine.compute([token("moving", "ward", "blue", 20 + index / 100, 20, { visionRadius: 50 })], "blue");
  assert.ok(engine.cacheInfo().size <= engine.cacheInfo().maxSize);
});

test("calibrated map bounds cover margins and reject invalid terrain/perspectives", () => {
  const map = terrain(15, 15);
  map.mapBounds = { left: 1, top: 2, width: 96, height: 95 };
  const engine = VisionEngine.create(map);
  const result = engine.compute([], "blue");
  assert.ok(Math.abs(area(result) - 10000) < 1e-6);
  assert.equal(engine.inspect({ x: .5, y: 20 }).inBounds, false);
  assert.equal(engine.inspect({ x: 1.01, y: 2.01 }).column, 0);
  assert.throws(() => engine.compute([], "purple"));
  assert.throws(() => VisionEngine.create({ width: 5, height: 5, flags: [] }));
});

test("a control ward exposes itself while suppressing a ward outside its brush", () => {
  const map = paint(terrain(), 34, 25, 36, 35, 1);
  const engine = VisionEngine.create(map);
  const control = piece("control", 35, 30, { type: "ward", team: "blue", wardKind: "control" });
  const enemyWard = piece("enemyWard", 30, 30, { type: "ward", team: "red" });
  const result = engine.compute([control, enemyWard], "red");
  assert.equal(result.sourceCount, 0);
  assert.deepEqual(result.disabledWardIds, ["enemyWard"]);
  assert.equal(seen(result, "control"), true);
  assert.ok(Math.abs(area(result) - 10000) < 1e-6, "exposure reveals the ward, not its surrounding map");
});

test("real Rift river scenario changes from hidden to warded to denied", () => {
  const engine = VisionEngine.create(require("../assets/vision-terrain.js"));
  const support = token("blue-sup", "champion", "blue", 59, 61);
  const jungler = token("red-jgl", "champion", "red", 59, 56.3);
  const ward = token("blue-ward", "ward", "blue", 58.3, 57.8, { wardKind: "stealth" });
  const control = token("red-control", "ward", "red", 59.8, 56.3, { wardKind: "control" });
  const hidden = engine.compute([support, jungler], "blue");
  assert.equal(seen(hidden, jungler.id), false, "river brush hides the jungler from blue support");
  const warded = engine.compute([support, jungler, ward], "blue");
  assert.equal(seen(warded, jungler.id), true, "a ward inside the connected brush reveals the jungler");
  const denied = engine.compute([support, jungler, ward, control], "blue");
  assert.equal(seen(denied, jungler.id), false, "denying blue's ward restores brush concealment");
  assert.equal(seen(denied, control.id), true, "the control ward exposes itself while denying sight");
  assert.deepEqual(denied.disabledWardIds, [ward.id]);
  assert.deepEqual(denied.blockedSourceIds, []);
});
