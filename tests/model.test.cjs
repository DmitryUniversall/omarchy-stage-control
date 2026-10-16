// Checks how Hyprland's state becomes desktops and window lists, and the move
// plans for removing and reordering desktops.
// Usage (from the plugin directory): node tests/model.test.cjs

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { load, plain } = require("./load.cjs");

const Model = load("Model.js");
let passed = 0;

// ---- splitJson -------------------------------------------------------------
{
  const text = '[{"title": "a ] tricky [ \\"title\\" {"}]\n\n[{"id": 1}]\n[]\n';
  const parts = plain(Model.splitJson(text));
  assert.equal(parts.length, 3);
  assert.equal(parts[0][0].title, 'a ] tricky [ "title" {');
  assert.deepEqual(parts[2], []);
  assert.throws(() => Model.splitJson('[{"a": 1}'), /truncated/);
  passed++;
}

// ---- fixtures ----------------------------------------------------------------
function client(address, cls, ws, at, size, extra) {
  return Object.assign({
    address, class: cls, title: cls + " window", mapped: true, hidden: false,
    workspace: { id: ws, name: String(ws) }, monitor: 0, at, size,
    floating: false, fullscreen: 0, pinned: false, focusHistoryID: 5,
  }, extra || {});
}

function world(clients, workspaces, monitors) {
  return Model.snapshot(clients, monitors || [{
    id: 0, name: "eDP-1", x: 0, y: 0, width: 2560, height: 1600, scale: 2, transform: 0,
    focused: true, activeWorkspace: { id: 1, name: "1" }, specialWorkspace: { id: 0, name: "" },
    reserved: [0, 26, 0, 0],
  }], workspaces);
}

const ws = (id, monitor, windows) => ({ id, name: String(id), monitor: monitor || "eDP-1", monitorID: 0, windows: windows || 1, hasfullscreen: false });

// ---- snapshot ----------------------------------------------------------------
{
  const snap = plain(world([
    client("0xa1", "foot", 1, [12, 64], [622, 724], { focusHistoryID: 0 }),
    client("0xa2", "firefox", 1, [646, 64], [622, 724], { focusHistoryID: 1 }),
    client("0xb1", "foot", 2, [12, 64], [1256, 724]),
    client("0xc1", "gimp", -99, [0, 0], [10, 10], { workspace: { id: -99, name: "special:minimized" } }),
    client("bogus", "x", 1, [0, 0], [1, 1]),
    client("0xu1", "x", 1, [0, 0], [1, 1], { mapped: false }),
  ], [ws(1, "eDP-1", 2), ws(2, "eDP-1", 1), { id: -99, name: "special:minimized", monitor: "eDP-1", monitorID: 0, windows: 1 }]));
  assert.equal(snap.monitors[0].w, 1280, "logical width");
  assert.equal(snap.monitors[0].h, 800, "logical height");
  assert.equal(snap.monitors[0].reserved.top, 26);
  assert.equal(snap.windows.length, 4, "invalid addresses and unmapped windows dropped");
  assert.equal(snap.windows.find((w) => w.address === "0xc1").special, true);
  assert.equal(Model.activeWindow(snap).address, "0xa1");
  const visible = plain(Model.visibleWindows(snap, snap.monitors[0])).map((w) => w.address);
  assert.deepEqual(visible, ["0xa1", "0xa2"], "only the active workspace, most recent first");
  assert.deepEqual(plain(Model.visibleWindows(snap, snap.monitors[0], 2)).map((w) => w.address), ["0xb1"],
    "another desktop's, as they'll be once it's on screen");
  assert.deepEqual(plain(Model.minimizedWindows(snap, "")).map((w) => w.address), ["0xc1"]);
  assert.deepEqual(plain(Model.appWindows(snap, "foot")).map((w) => w.address), ["0xa1", "0xb1"]);
  passed++;
}

// Rotated monitors swap their logical size.
{
  const snap = plain(world([], [], [{ id: 1, name: "DP-1", x: 1280, y: 0, width: 1920, height: 1080, scale: 1, transform: 1, activeWorkspace: { id: 3 }, specialWorkspace: { id: 0 }, reserved: [0, 0, 0, 0] }]));
  assert.equal(snap.monitors[0].w, 1080);
  assert.equal(snap.monitors[0].h, 1920);
  passed++;
}

// ---- desktops ----------------------------------------------------------------
{
  const snap = world([client("0xa", "foot", 1, [0, 0], [100, 100]), client("0xb", "foot", 4, [0, 0], [100, 100])],
    [ws(1), ws(4), ws(7, "DP-1")]);
  const list = plain(Model.desktops(snap, "eDP-1", [2, 7]));
  assert.deepEqual(list.map((d) => d.id), [1, 2, 4], "existing plus pinned; 7 lives on another monitor");
  assert.equal(list[0].active, true);
  assert.deepEqual(list[0].windows, ["0xa"]);
  assert.equal(Model.nextDesktopId(snap, { "eDP-1": [2] }), 8, "one past the highest id anywhere");
  passed++;
}

// ---- removal -----------------------------------------------------------------
function applyPlan(snap, plan) {
  const where = {};
  snap.windows.forEach((w) => { where[w.address] = w.workspace; });
  plan.moves.forEach((m) => { where[m.address] = m.to; });
  return where;
}

{
  // Four desktops, remove the second: its windows join desktop 1, 3 and 4 shift down.
  const snap = world([
    client("0x1", "a", 1, [0, 0], [10, 10]),
    client("0x2", "b", 2, [0, 0], [10, 10]),
    client("0x3", "c", 3, [0, 0], [10, 10]),
    client("0x4", "d", 4, [0, 0], [10, 10]),
  ], [ws(1), ws(2), ws(3), ws(4)]);
  const plan = plain(Model.removalPlan(snap, "eDP-1", {}, 2, true));
  assert.ok(plan.ok);
  assert.deepEqual(applyPlan(snap, plan), { "0x1": 1, "0x2": 1, "0x3": 2, "0x4": 3 });
  assert.deepEqual(plan.pinned, [1, 2, 3]);
  assert.equal(plan.focus, 0, "desktop 1 stays on screen");
  assert.equal(new Set(plan.moves.map((m) => m.address)).size, plan.moves.length, "each window moves once");

  // Without renumbering, the gap stays.
  const keep = plain(Model.removalPlan(snap, "eDP-1", {}, 2, false));
  assert.deepEqual(applyPlan(snap, keep), { "0x1": 1, "0x2": 1, "0x3": 3, "0x4": 4 });
  assert.deepEqual(keep.pinned, [1, 3, 4]);
  passed++;
}

{
  // Removing the first desktop merges it into the next, which becomes desktop 1.
  const snap = world([
    client("0x1", "a", 1, [0, 0], [10, 10]),
    client("0x2", "b", 2, [0, 0], [10, 10]),
    client("0x3", "c", 3, [0, 0], [10, 10]),
  ], [ws(1), ws(2), ws(3)]);
  const plan = plain(Model.removalPlan(snap, "eDP-1", {}, 1, true));
  assert.deepEqual(applyPlan(snap, plan), { "0x1": 1, "0x2": 1, "0x3": 2 });
  assert.deepEqual(plan.pinned, [1, 2]);
  assert.equal(plan.focus, 1, "the display shows the merged desktop 1");
  passed++;
}

{
  // Removing the desktop on screen switches to the one before it.
  const snap = Model.snapshot([client("0x3", "c", 3, [0, 0], [10, 10])], [{
    id: 0, name: "eDP-1", x: 0, y: 0, width: 1280, height: 800, scale: 1, transform: 0, focused: true,
    activeWorkspace: { id: 3 }, specialWorkspace: { id: 0 }, reserved: [0, 0, 0, 0],
  }], [ws(1), ws(3)]);
  const plan = plain(Model.removalPlan(snap, "eDP-1", { "eDP-1": [1, 2, 3] }, 3, true));
  assert.equal(plan.focus, 2, "3's windows go to 2, which is then on screen");
  assert.deepEqual(applyPlan(snap, plan), { "0x3": 2 });
  assert.deepEqual(plan.pinned, [1, 2]);
  passed++;
}

{
  // Renumbering never takes an id another monitor uses.
  const snap = world([
    client("0x1", "a", 1, [0, 0], [10, 10]),
    client("0x2", "b", 2, [0, 0], [10, 10]),
    client("0x4", "d", 4, [0, 0], [10, 10]),
    client("0x3", "c", 3, [0, 0], [10, 10], { monitor: 1 }),
  ], [ws(1), ws(2), ws(4), ws(3, "DP-1")]);
  const plan = plain(Model.removalPlan(snap, "eDP-1", {}, 2, true));
  // 3 belongs to DP-1, so this monitor's run ends at 2: 4 stays where it is.
  assert.deepEqual(applyPlan(snap, plan), { "0x1": 1, "0x2": 1, "0x4": 4, "0x3": 3 });
  passed++;
}

{
  // Only the gap the removal leaves closes; desktops further out (which window
  // rules may target) keep their numbers.
  const snap = world([
    client("0x1", "a", 1, [0, 0], [10, 10]),
    client("0x2", "b", 2, [0, 0], [10, 10]),
    client("0x3", "c", 3, [0, 0], [10, 10]),
    client("0x8", "music", 8, [0, 0], [10, 10]),
    client("0x9", "chat", 9, [0, 0], [10, 10]),
  ], [ws(1), ws(2), ws(3), ws(8), ws(9)]);
  const plan = plain(Model.removalPlan(snap, "eDP-1", {}, 2, true));
  assert.deepEqual(applyPlan(snap, plan), { "0x1": 1, "0x2": 1, "0x3": 2, "0x8": 8, "0x9": 9 });
  assert.deepEqual(plan.pinned, [1, 2, 8, 9]);
  passed++;
}

{
  // The last desktop can't be removed.
  const snap = world([client("0x1", "a", 1, [0, 0], [10, 10])], [ws(1)]);
  assert.equal(Model.removalPlan(snap, "eDP-1", {}, 1, true).ok, false);
  passed++;
}

// ---- reorder -----------------------------------------------------------------
{
  const snap = world([
    client("0x1", "a", 1, [0, 0], [10, 10]),
    client("0x2", "b", 2, [0, 0], [10, 10]),
    client("0x3", "c", 3, [0, 0], [10, 10]),
  ], [ws(1), ws(2), ws(3)]);
  // Drag desktop 3 to the front: 3's windows become desktop 1, the rest shift right.
  const plan = plain(Model.reorderPlan(snap, "eDP-1", {}, 3, 1));
  assert.deepEqual(applyPlan(snap, plan), { "0x1": 2, "0x2": 3, "0x3": 1 });
  assert.equal(plan.focus, 2, "the desktop on screen moved to position 2, and the display follows it");
  assert.equal(Model.reorderPlan(snap, "eDP-1", {}, 2, 2).ok, false);
  passed++;
}

// ---- kept desktops, as read back from the shell.json entry -------------------------
{
  assert.deepEqual(plain(Model.cleanDesktops({ "eDP-1": [1, 2, 2, 3], "DP-1": [4] })), { "eDP-1": [1, 2, 3], "DP-1": [4] }, "valid, deduplicated");
  assert.deepEqual(plain(Model.cleanDesktops({ "eDP-1": [0, -1, 1.5, "2", null, 100000, 7] })), { "eDP-1": [7] }, "only whole ids 1-99999");
  assert.deepEqual(plain(Model.cleanDesktops({ "bad name!": [1], "../x": [2], "": [3], "ok": "nope" })), {}, "display names and shapes checked");
  assert.deepEqual(plain(Model.cleanDesktops([1, 2])), {});
  assert.deepEqual(plain(Model.cleanDesktops(null)), {});
  const many = {};
  for (let i = 0; i < 40; i++) many["DP-" + i] = Array.from({ length: 200 }, (_, n) => n + 1);
  const capped = plain(Model.cleanDesktops(many));
  assert.equal(Object.keys(capped).length, 16, "at most 16 displays");
  assert.equal(capped["DP-0"].length, 64, "at most 64 desktops each");
  passed++;
}

// ---- desktop names ---------------------------------------------------------------
{
  assert.equal(Model.cleanDesktopName("  Web   dev \n"), "Web dev", "spaces collapsed, ends trimmed");
  assert.equal(Model.cleanDesktopName("a\u0000b\u202ec\u2028d"), "abcd", "control, bidi and line-separator characters dropped");
  assert.equal(Model.cleanDesktopName("x".repeat(40)), "x".repeat(32), "at most 32 characters");
  assert.equal(Model.cleanDesktopName("🎵".repeat(40)), "🎵".repeat(32), "characters, not UTF-16 halves");
  assert.equal(Model.cleanDesktopName(7), "");
  assert.equal(Model.cleanDesktopName("   "), "");

  assert.deepEqual(plain(Model.cleanDesktopNames({ "1": " Mail ", "3": "", "0": "zero", "07": "lead", "100000": "big", "x": "y", "5": 5 })),
    { "1": "Mail" }, "whole ids 1-99999 without leading zeros, non-empty names");
  assert.deepEqual(plain(Model.cleanDesktopNames(["Mail"])), {});
  assert.deepEqual(plain(Model.cleanDesktopNames(null)), {});
  const many = {};
  for (let i = 1; i <= 300; i++) many[String(i)] = "d" + i;
  assert.equal(Object.keys(plain(Model.cleanDesktopNames(many))).length, 128, "at most 128 names");
  passed++;
}

{
  // Four named desktops, remove the second: its name goes, 3 and 4 shift down
  // with their names, and a name on another display's desktop stays.
  const snap = world([
    client("0x1", "a", 1, [0, 0], [10, 10]),
    client("0x2", "b", 2, [0, 0], [10, 10]),
    client("0x3", "c", 3, [0, 0], [10, 10]),
    client("0x4", "d", 4, [0, 0], [10, 10]),
  ], [ws(1), ws(2), ws(3), ws(4), ws(9, "DP-1")]);
  const names = { "1": "Mail", "2": "Chat", "3": "Code", "4": "Music", "9": "Other display" };
  const renumbered = plain(Model.removalPlan(snap, "eDP-1", {}, 2, true));
  assert.deepEqual(plain(Model.carryNames(names, renumbered.carry)), { "1": "Mail", "2": "Code", "3": "Music", "9": "Other display" });
  const kept = plain(Model.removalPlan(snap, "eDP-1", {}, 2, false));
  assert.deepEqual(plain(Model.carryNames(names, kept.carry)), { "1": "Mail", "3": "Code", "4": "Music", "9": "Other display" }, "no renumbering: only the removed name goes");

  // Removing the first desktop: it merges into 2, which becomes desktop 1 and keeps its own name.
  const first = plain(Model.removalPlan(snap, "eDP-1", {}, 1, true));
  assert.deepEqual(plain(Model.carryNames({ "1": "Mail", "2": "Chat" }, first.carry)), { "1": "Chat" });

  // Dragging desktop 3 to the front: its windows and its name go to desktop 1.
  const reorder = plain(Model.reorderPlan(snap, "eDP-1", {}, 3, 1));
  assert.deepEqual(plain(Model.carryNames({ "1": "Mail", "3": "Code" }, reorder.carry)), { "1": "Code", "2": "Mail" });
  assert.deepEqual(plain(Model.carryNames({}, reorder.carry)), {}, "no names, none made up");
  passed++;
}

// ---- Lua for plans ---------------------------------------------------------
{
  const lua = Model.planLua([
    { address: "0xabc", to: 2 },
    { address: "0xdef\") os.exit(1) --", to: 2 },
    { address: "0x123", to: "3; os.exit()" },
    { address: "0x456", to: 1.5 },
  ], 2);
  assert.equal(lua.split("\n").length, 2, "only the valid move and the focus");
  // Run it against a stub hl to prove it's valid Lua doing the right thing.
  const out = execFileSync("lua", ["-e", `
    local log = {}
    hl = { dispatch = function(d) log[#log + 1] = d end,
           dsp = { focus = function(t) return "focus " .. t.workspace end,
                   window = { move = function(t) return "move " .. t.window .. " " .. t.workspace .. " " .. tostring(t.follow) end } } }
    ${lua}
    print(table.concat(log, "\\n"))`], { encoding: "utf8" });
  assert.equal(out.trim(), "move address:0xabc 2 false\nfocus 2");
  passed++;
}

// ---- how Hyprland draws a window ----------------------------------------------------
{
  const looks = plain(Model.looksFrom([
    { option: "decoration:blur:enabled", bool: true, set: true },
    { option: "decoration:blur:size", int: 4, set: true },
    { option: "decoration:blur:passes", int: 30, set: true },
    { option: "decoration:blur:brightness", float: 0.9, set: true },
    { option: "decoration:blur:ignore_opacity", bool: false, set: true },
    { option: "decoration:shadow:range", int: 25, set: true },
    { option: "decoration:shadow:color", gradient: "55000000 0deg", set: true },
    { option: "decoration:shadow:color_inactive", gradient: "ff112233 0deg", set: false },
    { option: "decoration:shadow:offset", vec2: [0, 5], set: true },
    { option: "decoration:inactive_opacity", float: 0.95, set: true },
    { option: "decoration:rounding_power", float: 2.0, set: false },
    "junk", [1], { option: "decoration:blur:size", float: "nan" },
  ]));
  assert.equal(looks.blur.size, 4);
  assert.equal(looks.blur.passes, 8, "Hyprland's own limit");
  assert.equal(looks.blur.brightness, 0.9);
  assert.equal(looks.blur.contrast, 0.8916, "Hyprland's default where missing");
  assert.equal(looks.blur.ignoreOpacity, false);
  assert.equal(looks.shadow.range, 25);
  assert.equal(looks.shadow.color, "#55000000");
  assert.equal(looks.shadow.colorInactive, null, "unset: the active color");
  assert.deepEqual(looks.shadow.offset, { x: 0, y: 5 });
  assert.deepEqual(looks.opacity, { active: 1, inactive: 0.95, fullscreen: 1 });
  assert.equal(looks.roundingPower, 2);
  assert.ok(Model.LOOK_OPTIONS.indexOf("decoration:blur:noise") >= 0);
  passed++;
}

// ---- what window rules give each window ------------------------------------------------
{
  const batch = Model.windowPropsBatch(["0xa", "nope", "0xb"]);
  assert.equal(batch.split(";").length, 2 * Model.WINDOW_PROPS.length, "valid addresses only");
  assert.ok(batch.startsWith("getprop address:0xa opacity;"), "no space before a command: Hyprland takes it as part of it");
  // 0xa answers everything; 0xb skips opacity_override (an older Hyprland), which mustn't shift the rest.
  const answer = (address, skip) => Model.WINDOW_PROPS.filter((prop) => prop !== skip).map((prop) => ({
    [prop]: { opacity: address === "0xa" ? 0.985 : 1, opacity_inactive: address === "0xa" ? 0.96 : 0.985, opacity_fullscreen: 1,
              opacity_override: false, opacity_inactive_override: address === "0xb", opacity_fullscreen_override: false,
              rounding: address === "0xa" ? 6 : 0, rounding_power: 2, border_size: 2, no_shadow: address === "0xb", decorate: true }[prop],
  }));
  const looks = plain(Model.windowLooksFrom([...answer("0xa"), ...answer("0xb", "opacity_override")], ["0xa", "0xb"]));
  assert.deepEqual(looks["0xa"], { opacity: 0.985, opacityOverride: false, opacityInactive: 0.96, opacityInactiveOverride: false,
    opacityFullscreen: 1, opacityFullscreenOverride: false, rounding: 6, roundingPower: 2, border: 2, shadow: true, decorate: true });
  assert.equal(looks["0xb"].opacityInactive, 0.985, "a skipped answer shifts nothing");
  assert.equal(looks["0xb"].opacityInactiveOverride, true);
  assert.equal(looks["0xb"].shadow, false);
  assert.equal(looks["0xb"].rounding, 0);

  const settings = plain(Model.looksFrom([{ option: "decoration:inactive_opacity", float: 0.95 }]));
  assert.equal(Model.windowAlpha(looks["0xa"], settings, "active"), 0.985, "the rule times the setting");
  assert.ok(Math.abs(Model.windowAlpha(looks["0xa"], settings, "inactive") - 0.96 * 0.95) < 1e-9);
  assert.equal(Model.windowAlpha(looks["0xb"], settings, "inactive"), 0.985, "unless the rule overrides it");
  assert.equal(Model.windowAlpha(null, settings, "inactive"), 0.95, "no rule: the setting");
  passed++;
}

// ---- Hyprland going to another desktop under the stage -------------------------
{
  const anim = (name, overridden, enabled, speed) => ({ name, overridden, enabled, speed, bezier: "", style: "" });
  const base = [anim("global", true, true, 10), anim("workspacesIn", false, true, 0), anim("workspacesOut", false, true, 0)];
  assert.equal(Model.workspaceAnimationMs([[...base, anim("workspaces", true, true, 6)], []]), 600);
  assert.equal(Model.workspaceAnimationMs([[...base, anim("workspaces", true, false, 1)]]), 0, "off");
  assert.equal(Model.workspaceAnimationMs([[...base, anim("workspaces", false, true, 0)]]), 1000, "as it takes it from global");
  assert.equal(Model.workspaceAnimationMs([[anim("global", true, true, 10), anim("workspaces", true, false, 1),
    anim("workspacesIn", true, true, 3), anim("workspacesOut", false, true, 0)]]), 300, "a child set on its own");
  assert.equal(Model.workspaceAnimationMs(null), null);
  assert.equal(Model.workspaceAnimationMs([[anim("global", true, true, 10)]]), null, "not Hyprland's list");
  assert.equal(Model.borderAnimationMs([[anim("global", true, true, 10), anim("border", true, true, 5.39)]]), 539);
  assert.equal(Model.borderAnimationMs([[anim("global", true, true, 10), anim("border", false, true, 0)]]), 1000, "as it takes it from global");
  assert.equal(Model.borderAnimationMs([[anim("global", true, false, 10), anim("border", false, true, 0)]]), 0, "off");
  assert.equal(Model.borderAnimationMs(null), null);

  const snap = world([
    client("0xa", "foot", 1, [0, 0], [10, 10]), client("0xb", "foot", 2, [0, 0], [10, 10]),
    client("0xc", "foot", 2, [0, 0], [10, 10], { pinned: true }),
    client("0xd", "foot", -98, [0, 0], [10, 10], { workspace: { id: -98, name: "special:minimized" } }),
  ], [ws(1), ws(2)]);
  assert.equal(Model.hiddenDesktopOf(snap, "0xa"), 0, "on screen");
  assert.equal(Model.hiddenDesktopOf(snap, "0xb"), 2);
  assert.equal(Model.hiddenDesktopOf(snap, "0xc"), 0, "pinned shows everywhere");
  assert.equal(Model.hiddenDesktopOf(snap, "0xd"), 0, "a special workspace isn't a desktop");
  assert.equal(Model.hiddenDesktopOf(snap, "0xe"), 0, "unknown");
  passed++;
}

// ---- decorations, layer surfaces, app names ------------------------------------
{
  const decor = plain(Model.decorFrom([
    { option: "general:border_size", int: 2, set: true },
    { option: "plugin:hyprbars:bar_height", int: 26, set: true },
    { option: "decoration:rounding", int: 999 },
    { option: "general:col.active_border", gradient: "66ffffff 0x22FFFFFF 90deg", set: true },
    { option: "general:col.inactive_border", gradient: "not a color", set: true },
    "no such option",
    [1, 2],
  ]));
  assert.deepEqual(decor, { border: 2, bar: 26, rounding: 200, active: { colors: ["#66ffffff", "#22ffffff"], angle: 90 }, inactive: null },
    "values read, clamped, junk ignored");
  assert.deepEqual(plain(Model.borderGradient("603a3a3a -45.5deg")), { colors: ["#603a3a3a"], angle: -45.5 });
  assert.equal(Model.borderGradient(42), null);
  assert.deepEqual(plain(Model.decorFrom([])), { border: 0, bar: 0, rounding: 0, active: null, inactive: null }, "no hyprbars, no title bar");

  const layers = {
    "eDP-1": { levels: {
      "0": [{ namespace: "omarchy-background", x: 0, y: 0, w: 1280, h: 800 }],
      "2": [{ namespace: "omarchy-bar", x: 0, y: 0, w: 1280, h: 26 }, { namespace: "omarchy-dock", x: 0, y: 688, w: 1280, h: 112 }],
      "3": [{ namespace: "marcho78-stage-control", x: 0, y: 0, w: 1280, h: 800 }, { namespace: "notifications", x: 900, y: 40, w: 0, h: 80 }],
    } },
    "DP-1": { levels: { "2": [{ namespace: "omarchy-bar", x: 1280, y: 0, w: 1920, h: 26 }] } },
  };
  const found = plain(Model.surfaces(layers, { name: "eDP-1", x: 0, y: 0 }));
  assert.deepEqual(found.map((s) => s.namespace), ["omarchy-bar", "omarchy-dock"], "top and overlay only, not Stage Control's own, not empty ones");
  const other = plain(Model.surfaces(layers, { name: "DP-1", x: 1280, y: 0 }));
  assert.equal(other[0].x, 0, "monitor coordinates");
  assert.deepEqual(plain(Model.surfaces(null, { name: "eDP-1", x: 0, y: 0 })), []);

  assert.equal(Model.appName("org.gnome.Nautilus"), "Nautilus");
  assert.equal(Model.appName("herdr-gui"), "Herdr Gui");
  assert.equal(Model.appName("foot"), "Foot");
  assert.equal(Model.appName(""), "Window");
  assert.equal(Model.appName("chrome-app.hey.com__-Default"), "app.hey.com", "a web app is named by its site");
  passed++;
}

// ---- which app a window belongs to ------------------------------------------------
{
  assert.deepEqual(plain(Model.appKeys("org.localsend.localsend_app")), ["org.localsend.localsend_app", "localsend_app", "localsend"]);
  assert.deepEqual(plain(Model.appKeys("org.gnome.Nautilus")), ["org.gnome.Nautilus", "Nautilus"]);
  assert.deepEqual(plain(Model.appKeys("com.example.app")), ["com.example.app", "example"], "a generic last part is skipped");
  assert.deepEqual(plain(Model.appKeys("herdr-gui")), ["herdr-gui", "herdr"]);
  assert.deepEqual(plain(Model.appKeys("foot")), ["foot"]);
  assert.deepEqual(plain(Model.appKeys("")), []);
  assert.deepEqual(plain(Model.appKeys("chrome-app.hey.com__-Default")), ["chrome-app.hey.com__-Default", "hey"], "a web app by its site's name");

  assert.equal(Model.webAppHost("chrome-app.hey.com__-Default"), "app.hey.com");
  assert.equal(Model.webAppHost("chrome-www.youtube.com__-Default"), "youtube.com");
  assert.equal(Model.webAppHost("chrome-discord.com__channels_@me-Profile_1"), "discord.com");
  assert.equal(Model.webAppHost("chrome-nngceckbapebfimnlniiiahkandclblb-Default"), "", "an extension, not a site");
  assert.equal(Model.webAppHost("chromium"), "");

  assert.equal(Model.launchedSite("omarchy-launch-webapp https://web.whatsapp.com/"), "web.whatsapp.com");
  assert.equal(Model.launchedSite('omarchy-launch-webapp "https://www.youtube.com/"'), "youtube.com");
  assert.equal(Model.launchedSite("chromium --app=https://x.com/home"), "x.com");
  assert.equal(Model.launchedSite("omarchy-webapp-handler-hey %u"), "", "a handler names no site");
  assert.equal(Model.launchedSite(undefined), "");

  assert.equal(Model.siteName("app.hey.com"), "hey");
  assert.equal(Model.siteName("bbc.co.uk"), "bbc");
  assert.equal(Model.siteName("x.com"), "x");
  assert.equal(Model.siteName("localhost"), "");
  passed++;
}

// A window's title, and its first one: the stage falls back to the first
// when a window clears its title.
{
  const snap = world([
    client("0xa", "kitty", 1, [0, 0], [10, 10], { title: "", initialTitle: "kitty" }),
    client("0xb", "foot", 1, [20, 0], [10, 10]),
  ], [ws(1)]);
  assert.equal(snap.windows[0].title, "kitty", "no title: the first");
  assert.equal(snap.windows[0].initialTitle, "kitty");
  assert.equal(snap.windows[1].title, "foot window");
  assert.equal(snap.windows[1].initialTitle, "", "no first title given");
  passed++;
}

// Hyprland's workspace swipe options, its defaults where one is missing.
{
  assert.deepEqual(plain(Model.swipeFrom([])), { distance: 300, invert: true, cancelRatio: 0.5, minSpeed: 30, forever: false });
  const swipe = plain(Model.swipeFrom([
    { option: "general:border_size", int: 2 },
    { option: "gestures:workspace_swipe_distance", int: 500 },
    { option: "gestures:workspace_swipe_invert", bool: false },
    { option: "gestures:workspace_swipe_cancel_ratio", float: 0.1 },
    { option: "gestures:workspace_swipe_min_speed_to_force", int: 0 },
    { option: "gestures:workspace_swipe_forever", bool: true },
  ]));
  assert.deepEqual(swipe, { distance: 500, invert: false, cancelRatio: 0.1, minSpeed: 0, forever: true });
  assert.equal(Model.swipeFrom([{ option: "gestures:workspace_swipe_distance", int: 0 }]).distance, 20, "never zero");
  passed++;
}

console.log(`model: ${passed} checks passed`);
