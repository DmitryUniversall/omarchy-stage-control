// Model.js - what Hyprland has, in the shape the stage needs.
//
// The service reads one snapshot per opening with
//   hyprctl -j --batch "clients; monitors; workspaces"
// and everything below is derived from it: the desktops on each display, the
// windows to spread out, and the plans (lists of moves) for adding, removing
// and reordering desktops. Pure functions; tests/model.test.cjs.

// hyprctl --batch prints its JSON answers back to back (and plain text for
// an option it doesn't know); split them apart. It goes from bracket to
// bracket and over whole strings with a search rather than a character at a
// time, which in the shell's JavaScript took twice as long.
function splitJson(text) {
  var out = []
  var value = String(text || "")
  var depth = 0, start = -1
  var next = /[\[\]{}"]/g
  var quote = /["\\]/g
  var found
  while ((found = next.exec(value)) !== null) {
    var c = found[0]
    if (c === "\"") {
      // To the closing quote, over escaped characters.
      quote.lastIndex = found.index + 1
      var end
      while ((end = quote.exec(value)) !== null && end[0] === "\\") quote.lastIndex = end.index + 2
      if (end === null) break
      next.lastIndex = end.index + 1
    } else if (c === "[" || c === "{") {
      if (depth === 0) start = found.index
      depth++
    } else {
      depth--
      if (depth === 0 && start >= 0) {
        out.push(JSON.parse(value.slice(start, found.index + 1)))
        start = -1
      }
      if (depth < 0) throw new Error("unbalanced JSON")
    }
  }
  if (depth !== 0) throw new Error("truncated JSON")
  return out
}

function isAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{1,16}$/.test(value)
}

function int(value, fallback) {
  var n = Number(value)
  return isFinite(n) ? Math.round(n) : fallback
}

function pair(value) {
  return Array.isArray(value) && value.length >= 2 ? [Number(value[0]) || 0, Number(value[1]) || 0] : [0, 0]
}

// A normalized snapshot: logical monitor sizes, window rects in global
// layout coordinates, and which workspace each monitor shows.
function snapshot(clients, monitors, workspaces) {
  var mons = (Array.isArray(monitors) ? monitors : []).filter(function(m) {
    return m && !m.disabled && typeof m.name === "string"
  }).map(function(m) {
    var scale = Number(m.scale) > 0 ? Number(m.scale) : 1
    var rotated = (int(m.transform, 0) % 2) === 1
    var width = Math.round((rotated ? m.height : m.width) / scale)
    var height = Math.round((rotated ? m.width : m.height) / scale)
    var reserved = Array.isArray(m.reserved) ? m.reserved : [0, 0, 0, 0]
    return {
      id: int(m.id, -1),
      name: m.name,
      x: int(m.x, 0), y: int(m.y, 0),
      w: width, h: height,
      scale: scale,
      // Frames a second; the stage's animations step a frame at a time.
      refreshRate: Number(m.refreshRate) > 0 ? Number(m.refreshRate) : 60,
      focused: m.focused === true,
      activeWorkspace: m.activeWorkspace ? int(m.activeWorkspace.id, 0) : 0,
      specialWorkspace: m.specialWorkspace ? int(m.specialWorkspace.id, 0) : 0,
      specialName: m.specialWorkspace ? String(m.specialWorkspace.name || "") : "",
      reserved: { left: int(reserved[0], 0), top: int(reserved[1], 0), right: int(reserved[2], 0), bottom: int(reserved[3], 0) }
    }
  })

  var wss = (Array.isArray(workspaces) ? workspaces : []).filter(function(w) {
    return w && typeof w.id === "number"
  }).map(function(w) {
    return {
      id: w.id,
      name: String(w.name || w.id),
      monitor: String(w.monitor || ""),
      monitorId: int(w.monitorID, -1),
      windows: int(w.windows, 0),
      hasFullscreen: w.hasfullscreen === true,
      special: w.id < 0
    }
  })

  var wins = (Array.isArray(clients) ? clients : []).filter(function(c) {
    return c && isAddress(c.address) && c.mapped !== false && c.workspace && typeof c.workspace.id === "number"
  }).map(function(c) {
    var at = pair(c.at)
    var size = pair(c.size)
    var wsName = String(c.workspace.name || "")
    return {
      address: c.address,
      cls: String(c.class || c.initialClass || ""),
      title: String(c.title || c.initialTitle || ""),
      initialTitle: String(c.initialTitle || ""),
      workspace: c.workspace.id,
      workspaceName: wsName,
      special: c.workspace.id < 0 || wsName.indexOf("special:") === 0,
      monitor: int(c.monitor, -1),
      x: at[0], y: at[1], w: Math.max(1, size[0]), h: Math.max(1, size[1]),
      floating: c.floating === true,
      fullscreen: int(c.fullscreen, 0),
      pinned: c.pinned === true,
      hidden: c.hidden === true,
      // In a tab group with other windows.
      grouped: Array.isArray(c.grouped) && c.grouped.length > 1,
      focus: int(c.focusHistoryID, 9999),
      xwayland: c.xwayland === true
    }
  })

  return { monitors: mons, workspaces: wss, windows: wins }
}

// Layer-shell surfaces above the windows (bar, dock, notifications) on one
// monitor, in monitor coordinates, from `hyprctl -j layers`. Stage Control's own
// surfaces are left out. `whole`: it covers the whole display (Omarchy's
// notifications, one surface for all, whatever shows in it). The stage draws
// them from the screen as it opened (Overview), and one of those, put back
// as the stage closed on another desktop, put back the whole desktop it had
// left.
function surfaces(layers, monitor) {
  var out = []
  if (!layers || typeof layers !== "object" || !monitor) return out
  var entry = layers[monitor.name]
  var levels = entry && entry.levels ? entry.levels : {}
  ;["2", "3"].forEach(function(level) {
    ;(Array.isArray(levels[level]) ? levels[level] : []).forEach(function(surface) {
      var name = String(surface && surface.namespace || "")
      if (name.indexOf("marcho78-stage-control") === 0) return
      var w = int(surface.w, 0), h = int(surface.h, 0)
      if (w <= 0 || h <= 0) return
      var whole = monitor.w > 0 && monitor.h > 0 && w >= monitor.w && h >= monitor.h
      out.push({ namespace: name, level: Number(level), x: int(surface.x, 0) - monitor.x, y: int(surface.y, 0) - monitor.y, w: w, h: h, whole: whole })
    })
  })
  return out
}

// Border, title bar (hyprbars, from the Title Bars plugin) and corner rounding,
// from the getoption answers in the same batch. Missing options count as 0.
function decorFrom(parts) {
  var decor = { border: 0, bar: 0, rounding: 0, active: null, inactive: null }
  ;(parts || []).forEach(function(part) {
    if (!part || typeof part !== "object" || Array.isArray(part)) return
    var value = Math.max(0, Math.min(200, int(part.int, 0)))
    if (part.option === "general:border_size") decor.border = value
    else if (part.option === "plugin:hyprbars:bar_height") decor.bar = value
    else if (part.option === "decoration:rounding") decor.rounding = value
    else if (part.option === "general:col.active_border") decor.active = borderGradient(part.gradient)
    else if (part.option === "general:col.inactive_border") decor.inactive = borderGradient(part.gradient)
  })
  return decor
}

// A border's colors as Hyprland gives them ("66ffffff 22ffffff 90deg":
// AARRGGBB colors, then the angle) as { colors: ["#66ffffff", ...], angle }:
// colors as QML takes them, and the angle in degrees. Null when it isn't one.
var gradientColorRe = /^(?:0x)?([0-9a-fA-F]{8})$/
var gradientAngleRe = /^(-?[0-9]+(?:\.[0-9]+)?)deg$/
function borderGradient(text) {
  if (typeof text !== "string" || text.length > 400) return null
  var colors = [], angle = 0
  text.trim().split(/\s+/).forEach(function(token) {
    var color = gradientColorRe.exec(token)
    var turn = gradientAngleRe.exec(token)
    if (color && colors.length < 10) colors.push("#" + color[1].toLowerCase())
    else if (turn) angle = Number(turn[1])
  })
  return colors.length ? { colors: colors, angle: angle } : null
}

// What window rules give each window of its looks, beyond the decoration
// settings (looksFrom): Omarchy's rules give most windows an opacity of
// 0.985 active and 0.96 inactive, browsers 1 and 0.985. Read with
// `hyprctl getprop`, a batch of them per read (Service.readWindowLooks).
var WINDOW_PROPS = [
  "opacity", "opacity_override", "opacity_inactive", "opacity_inactive_override",
  "opacity_fullscreen", "opacity_fullscreen_override", "rounding", "rounding_power", "border_size",
  "no_shadow", "decorate"
]

// The getprop batch for `addresses`: WINDOW_PROPS of each, in order.
function windowPropsBatch(addresses) {
  var commands = []
  ;(addresses || []).forEach(function(address) {
    if (!isAddress(address)) return
    WINDOW_PROPS.forEach(function(prop) { commands.push("getprop address:" + address + " " + prop) })
  })
  return commands.join(";")
}

// The batch's answers ({ "<prop>": value } each, in the order asked) as
// { address: { opacity, opacityOverride, ..., decorate } }. A prop Hyprland
// didn't answer (an older Hyprland, a window gone) is skipped, not shifted
// onto the next.
function windowLooksFrom(parts, addresses) {
  var asked = []
  ;(addresses || []).forEach(function(address) {
    if (!isAddress(address)) return
    WINDOW_PROPS.forEach(function(prop) { asked.push({ address: address, prop: prop }) })
  })
  var found = {}
  var at = 0
  ;(parts || []).forEach(function(part) {
    if (!part || typeof part !== "object" || Array.isArray(part)) return
    var keys = Object.keys(part)
    if (keys.length !== 1) return
    while (at < asked.length && asked[at].prop !== keys[0]) at++
    if (at >= asked.length) return
    var entry = found[asked[at].address] || (found[asked[at].address] = {})
    entry[asked[at].prop] = part[keys[0]]
    at++
  })
  function number(raw, key, min, max, fallback) {
    var value = Number(raw[key])
    return raw[key] !== undefined && raw[key] !== null && isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
  }
  var out = {}
  for (var address in found) {
    var raw = found[address]
    var num = function(key, min, max, fallback) { return number(raw, key, min, max, fallback) }
    out[address] = {
      opacity: num("opacity", 0, 1, 1), opacityOverride: raw.opacity_override === true,
      opacityInactive: num("opacity_inactive", 0, 1, 1), opacityInactiveOverride: raw.opacity_inactive_override === true,
      opacityFullscreen: num("opacity_fullscreen", 0, 1, 1), opacityFullscreenOverride: raw.opacity_fullscreen_override === true,
      rounding: raw.rounding === undefined ? null : num("rounding", 0, 1000, 0),
      roundingPower: raw.rounding_power === undefined ? null : num("rounding_power", 1, 10, 2),
      border: raw.border_size === undefined ? null : num("border_size", 0, 200, 0),
      shadow: raw.no_shadow !== true,
      decorate: raw.decorate !== false
    }
  }
  return out
}

// A window's opacity as Hyprland draws it (CWindow::updateDecorationValues):
// its rule's times the setting's, unless the rule overrides it. `state` is
// "active", "inactive" or "fullscreen"; `window` from windowLooksFrom (or
// null: no rule), `looks` from looksFrom.
function windowAlpha(window, looks, state) {
  var base = looks ? looks.opacity[state] : 1
  if (!window) return base
  var rule = state === "active" ? window.opacity : state === "inactive" ? window.opacityInactive : window.opacityFullscreen
  var override = state === "active" ? window.opacityOverride : state === "inactive" ? window.opacityInactiveOverride : window.opacityFullscreenOverride
  return override ? rule : rule * base
}

// What Hyprland draws of a window besides its pixels and its border
// (decorFrom): the blur behind it, its shadow and its opacity, for the
// stage to draw the same where the windows come to rest (HyprBlur,
// WindowTile). Read with each registration (Service.looksRun), with these
// options; Hyprland's defaults where one is missing.
var LOOK_OPTIONS = [
  "decoration:blur:enabled", "decoration:blur:size", "decoration:blur:passes", "decoration:blur:contrast",
  "decoration:blur:brightness", "decoration:blur:vibrancy", "decoration:blur:vibrancy_darkness",
  "decoration:blur:noise", "decoration:blur:ignore_opacity",
  "decoration:shadow:enabled", "decoration:shadow:range", "decoration:shadow:render_power",
  "decoration:shadow:color", "decoration:shadow:color_inactive", "decoration:shadow:offset",
  "decoration:shadow:scale", "decoration:shadow:sharp",
  "decoration:active_opacity", "decoration:inactive_opacity", "decoration:fullscreen_opacity",
  "decoration:rounding_power"
]

function looksFrom(parts) {
  var looks = {
    blur: { enabled: true, size: 8, passes: 1, contrast: 0.8916, brightness: 0.8172, vibrancy: 0.1696,
            vibrancyDarkness: 0, noise: 0.0117, ignoreOpacity: true },
    shadow: { enabled: true, range: 4, renderPower: 3, color: "#ee1a1a1a", colorInactive: null,
              offset: { x: 0, y: 0 }, scale: 1, sharp: false },
    opacity: { active: 1, inactive: 1, fullscreen: 1 },
    roundingPower: 2
  }
  ;(parts || []).forEach(function(part) {
    if (!part || typeof part !== "object" || Array.isArray(part) || typeof part.option !== "string") return
    var raw = part.float !== undefined ? part.float : part.int
    function number(min, max, fallback) {
      var value = Number(raw)
      return raw !== undefined && raw !== null && isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
    }
    var on = part.bool !== undefined ? part.bool === true : part.int !== undefined ? Number(part.int) !== 0 : null
    var color = borderGradient(part.gradient)
    var blur = looks.blur, shadow = looks.shadow, opacity = looks.opacity
    switch (part.option) {
    case "decoration:blur:enabled": if (on !== null) blur.enabled = on; break
    case "decoration:blur:size": blur.size = number(0, 100, blur.size); break
    case "decoration:blur:passes": blur.passes = Math.round(number(1, 8, blur.passes)); break
    case "decoration:blur:contrast": blur.contrast = number(0, 2, blur.contrast); break
    case "decoration:blur:brightness": blur.brightness = number(0, 2, blur.brightness); break
    case "decoration:blur:vibrancy": blur.vibrancy = number(0, 1, blur.vibrancy); break
    case "decoration:blur:vibrancy_darkness": blur.vibrancyDarkness = number(0, 1, blur.vibrancyDarkness); break
    case "decoration:blur:noise": blur.noise = number(0, 1, blur.noise); break
    case "decoration:blur:ignore_opacity": if (on !== null) blur.ignoreOpacity = on; break
    case "decoration:shadow:enabled": if (on !== null) shadow.enabled = on; break
    case "decoration:shadow:range": shadow.range = Math.round(number(0, 200, shadow.range)); break
    case "decoration:shadow:render_power": shadow.renderPower = Math.round(number(1, 4, shadow.renderPower)); break
    case "decoration:shadow:color": if (color) shadow.color = color.colors[0]; break
    // Unset, Hyprland draws inactive windows' shadows in `color` too.
    case "decoration:shadow:color_inactive": if (color && part.set !== false) shadow.colorInactive = color.colors[0]; break
    case "decoration:shadow:offset":
      var at = pair(part.vec2)
      shadow.offset = { x: Math.max(-500, Math.min(500, at[0])), y: Math.max(-500, Math.min(500, at[1])) }
      break
    case "decoration:shadow:scale": shadow.scale = number(0, 1, shadow.scale); break
    case "decoration:shadow:sharp": if (on !== null) shadow.sharp = on; break
    case "decoration:active_opacity": opacity.active = number(0, 1, opacity.active); break
    case "decoration:inactive_opacity": opacity.inactive = number(0, 1, opacity.inactive); break
    case "decoration:fullscreen_opacity": opacity.fullscreen = number(0, 1, opacity.fullscreen); break
    case "decoration:rounding_power": looks.roundingPower = number(1, 10, looks.roundingPower); break
    }
  })
  return looks
}

// How Hyprland's own desktop swipe is set up (the gestures:workspace_swipe_*
// options in the same batch), so the stage's follows the fingers the same
// way: `distance` swipe units move a whole desktop, `invert` flips which way
// is next, a swipe goes on past `cancelRatio` of a desktop, or when its
// fingers moved at least `minSpeed` units an event on average; with
// `forever` one swipe can pass more than one desktop. Hyprland's defaults
// where an option is missing.
function swipeFrom(parts) {
  var swipe = { distance: 300, invert: true, cancelRatio: 0.5, minSpeed: 30, forever: false }
  ;(parts || []).forEach(function(part) {
    if (!part || typeof part !== "object" || Array.isArray(part)) return
    if (part.option === "gestures:workspace_swipe_distance") swipe.distance = Math.max(20, Math.min(5000, int(part.int, 300)))
    else if (part.option === "gestures:workspace_swipe_invert") swipe.invert = part.bool !== false && part.int !== 0
    else if (part.option === "gestures:workspace_swipe_cancel_ratio") {
      var ratio = Number(part.float)
      swipe.cancelRatio = isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0.5
    }
    else if (part.option === "gestures:workspace_swipe_forever") swipe.forever = part.bool === true || part.int === 1
    else if (part.option === "gestures:workspace_swipe_min_speed_to_force") swipe.minSpeed = Math.max(0, Math.min(1000, int(part.int, 30)))
  })
  return swipe
}

function monitorByName(snap, name) {
  for (var i = 0; i < snap.monitors.length; i++) if (snap.monitors[i].name === name) return snap.monitors[i]
  return null
}

function monitorById(snap, id) {
  for (var i = 0; i < snap.monitors.length; i++) if (snap.monitors[i].id === id) return snap.monitors[i]
  return null
}

function focusedMonitor(snap) {
  for (var i = 0; i < snap.monitors.length; i++) if (snap.monitors[i].focused) return snap.monitors[i]
  return snap.monitors.length ? snap.monitors[0] : null
}

// The focused window: the one Hyprland focused most recently.
function activeWindow(snap) {
  var best = null
  snap.windows.forEach(function(w) {
    if (!w.hidden && (best === null || w.focus < best.focus)) best = w
  })
  return best
}

// Windows visible on a monitor right now, front to back: its active workspace,
// its open special workspace, and pinned windows. With `desktop`, the ones
// that will be once that desktop is on screen.
function visibleWindows(snap, monitor, desktop) {
  if (!monitor) return []
  var shown = desktop === undefined ? monitor.activeWorkspace : desktop
  return snap.windows.filter(function(w) {
    if (w.hidden || w.monitor !== monitor.id) return false
    if (w.pinned) return true
    if (w.workspace === shown) return true
    return monitor.specialWorkspace !== 0 && w.workspace === monitor.specialWorkspace
  }).sort(function(a, b) { return a.focus - b.focus })
}

// The windows of desktop `id` on `monitor`, as visibleWindows() would give
// them if it were on screen, without the ones pinned to every desktop.
function desktopWindows(snap, monitor, id) {
  if (!monitor) return []
  return snap.windows.filter(function(w) {
    return !w.hidden && !w.pinned && w.monitor === monitor.id && w.workspace === id
  }).sort(function(a, b) { return a.focus - b.focus })
}

// Window rect relative to the monitor's top-left corner.
function localRect(w, monitor) {
  return { x: w.x - monitor.x, y: w.y - monitor.y, w: w.w, h: w.h }
}

// The regular (non-special) desktops on a monitor: every workspace Hyprland has
// there, plus desktops Stage Control keeps even when empty (`pinned`).
function desktops(snap, monitorName, pinned) {
  var monitor = monitorByName(snap, monitorName)
  var ids = {}
  snap.workspaces.forEach(function(ws) {
    if (!ws.special && ws.id > 0 && ws.monitor === monitorName) ids[ws.id] = true
  })
  ;(Array.isArray(pinned) ? pinned : []).forEach(function(id) {
    // A pinned desktop that Hyprland has put on another monitor belongs there.
    var elsewhere = snap.workspaces.some(function(ws) { return ws.id === id && ws.monitor !== monitorName })
    if (int(id, 0) > 0 && !elsewhere) ids[int(id, 0)] = true
  })
  if (monitor && monitor.activeWorkspace > 0) ids[monitor.activeWorkspace] = true
  return Object.keys(ids).map(Number).sort(function(a, b) { return a - b }).map(function(id) {
    var ws = null
    for (var i = 0; i < snap.workspaces.length; i++) if (snap.workspaces[i].id === id) ws = snap.workspaces[i]
    var windows = snap.windows.filter(function(w) { return w.workspace === id && !w.hidden })
    var fullscreen = null
    windows.forEach(function(w) { if (w.fullscreen === 2 && !fullscreen) fullscreen = w })
    return {
      id: id,
      name: ws ? ws.name : String(id),
      active: !!monitor && monitor.activeWorkspace === id,
      windows: windows.map(function(w) { return w.address }),
      fullscreenClass: fullscreen ? fullscreen.cls : "",
      fullscreenTitle: fullscreen ? fullscreen.title : ""
    }
  })
}

// Every desktop id in use on any monitor.
function usedIds(snap, pinnedByMonitor) {
  var used = {}
  snap.workspaces.forEach(function(ws) { if (!ws.special && ws.id > 0) used[ws.id] = true })
  Object.keys(pinnedByMonitor || {}).forEach(function(name) {
    ;(pinnedByMonitor[name] || []).forEach(function(id) { if (int(id, 0) > 0) used[int(id, 0)] = true })
  })
  return used
}

// The desktops Stage Control keeps per display, as stored on its shell.json entry:
// { "<display name>": [desktop ids] }. Anything else is dropped.
function cleanDesktops(value) {
  var clean = {}
  if (!value || typeof value !== "object" || Array.isArray(value)) return clean
  Object.keys(value).slice(0, 16).forEach(function(name) {
    if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(name) || !Array.isArray(value[name])) return
    var seen = {}
    clean[name] = value[name].filter(function(id) {
      var ok = typeof id === "number" && isFinite(id) && id > 0 && id < 100000 && Math.round(id) === id && !seen[id]
      if (ok) seen[id] = true
      return ok
    }).slice(0, 64)
  })
  return clean
}

// A desktop's name as typed: control characters and line breaks dropped,
// spaces collapsed, at most 32 characters. "" means the default name.
var nameJunkRe = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g
var spacesRe = /\s+/g

function cleanDesktopName(value) {
  if (typeof value !== "string") return ""
  var text = value.replace(nameJunkRe, "").replace(spacesRe, " ").trim()
  return Array.from(text).slice(0, 32).join("").trim()
}

// Desktop names as stored on the shell.json entry: { "<desktop id>": "name" }.
// Ids are Hyprland's, which are unique across displays.
function cleanDesktopNames(value) {
  var clean = {}
  if (!value || typeof value !== "object" || Array.isArray(value)) return clean
  Object.keys(value).slice(0, 128).forEach(function(key) {
    if (!/^[1-9][0-9]{0,4}$/.test(key)) return
    var name = cleanDesktopName(value[key])
    if (name) clean[key] = name
  })
  return clean
}

// Names after a plan moves desktops' contents around: a desktop in `carry`
// hands its name to carry[id], or loses it where that is 0 (removed). Names of
// desktops the plan doesn't touch stay.
function carryNames(names, carry) {
  var next = {}
  Object.keys(names || {}).forEach(function(key) {
    if (carry[key] === undefined) next[key] = names[key]
  })
  Object.keys(carry || {}).forEach(function(key) {
    if (names[key] && carry[key] > 0) next[String(carry[key])] = names[key]
  })
  return next
}

// macOS adds a desktop at the end of the row: one past the highest in use.
function nextDesktopId(snap, pinnedByMonitor) {
  var used = usedIds(snap, pinnedByMonitor)
  var max = 0
  Object.keys(used).forEach(function(id) { max = Math.max(max, Number(id)) })
  return max + 1
}

// Ids that desktops on other monitors use (existing or pinned there).
function ownedElsewhere(snap, monitorName, pinnedByMonitor) {
  var owned = {}
  snap.workspaces.forEach(function(ws) {
    if (!ws.special && ws.id > 0 && ws.monitor !== monitorName) owned[ws.id] = true
  })
  Object.keys(pinnedByMonitor || {}).forEach(function(name) {
    if (name === monitorName) return
    ;(pinnedByMonitor[name] || []).forEach(function(other) { if (int(other, 0) > 0) owned[int(other, 0)] = true })
  })
  return owned
}

// Every window on one of `ids` that must end up somewhere else: `destination`
// maps each desktop id to the id its windows should be on afterwards.
function movesFor(snap, ids, destination) {
  var moves = []
  snap.windows.forEach(function(w) {
    if (w.pinned || ids.indexOf(w.workspace) < 0) return
    var to = destination(w.workspace)
    if (to !== w.workspace) moves.push({ address: w.address, to: to })
  })
  return moves
}

// What removing desktop `id` from a monitor takes: its windows move to the
// desktop before it (or after it, for the first), and the display switches
// there if it was showing `id`. With `renumber`, the desktops right after it
// shift down to close the gap, so desktop N stays workspace N (Super+N).
// Every window moves once, straight to where it ends up.
// Returns { ok, reason, moves: [{ address, to }], focus: id|0, pinned: [ids],
// carry: { id: new id, or 0 for the removed one } } (see carryNames).
function removalPlan(snap, monitorName, pinnedByMonitor, id, renumber) {
  var pinnedHere = (pinnedByMonitor && pinnedByMonitor[monitorName]) || []
  var list = desktops(snap, monitorName, pinnedHere).map(function(d) { return d.id })
  var index = list.indexOf(id)
  if (index < 0) return { ok: false, reason: "no such desktop" }
  if (list.length <= 1) return { ok: false, reason: "the last desktop can't be removed" }
  var monitor = monitorByName(snap, monitorName)
  var target = index > 0 ? list[index - 1] : list[index + 1]
  var remaining = list.filter(function(other) { return other !== id })

  // Close the gap the removal leaves: the desktops right after it, as long
  // as they run on without a gap of their own, each move down one. Desktops
  // further out (say 8 and 9, which window rules may target) stay put.
  var shift = {}
  if (renumber) {
    var owned = ownedElsewhere(snap, monitorName, pinnedByMonitor)
    for (var next = id + 1; remaining.indexOf(next) >= 0 && !owned[next - 1]; next++) shift[next] = next - 1
  }
  function renamed(other) { return shift[other] !== undefined ? shift[other] : other }

  var moves = movesFor(snap, list, function(from) { return renamed(from === id ? target : from) })
  var focus = 0
  if (monitor) {
    if (monitor.activeWorkspace === id) focus = renamed(target)
    else if (shift[monitor.activeWorkspace] !== undefined) focus = shift[monitor.activeWorkspace]
  }
  var carry = {}
  remaining.forEach(function(other) { carry[other] = renamed(other) })
  carry[id] = 0
  return { ok: true, moves: moves, focus: focus, pinned: remaining.map(renamed), carry: carry }
}

// Dragging a desktop in the Spaces bar to another desktop's place, as on
// macOS: the dragged desktop takes that position and the ones in between
// shift over by one. Desktop ids stay put; their windows move, and so do their
// names (carry, as in removalPlan).
// Returns { ok, moves, focus, carry }.
function reorderPlan(snap, monitorName, pinnedByMonitor, fromId, toId) {
  var pinnedHere = (pinnedByMonitor && pinnedByMonitor[monitorName]) || []
  var list = desktops(snap, monitorName, pinnedHere).map(function(d) { return d.id })
  var from = list.indexOf(fromId)
  var to = list.indexOf(toId)
  if (from < 0 || to < 0 || from === to) return { ok: false, moves: [], focus: 0 }
  var order = list.slice()
  order.splice(from, 1)
  order.splice(to, 0, fromId)
  // order[p] is the desktop whose windows now belong at list[p].
  var destinationOf = {}
  order.forEach(function(content, position) { destinationOf[content] = list[position] })
  var moves = movesFor(snap, list, function(content) { return destinationOf[content] })
  var monitor = monitorByName(snap, monitorName)
  var focus = 0
  if (monitor && destinationOf[monitor.activeWorkspace] !== undefined
      && destinationOf[monitor.activeWorkspace] !== monitor.activeWorkspace)
    focus = destinationOf[monitor.activeWorkspace]
  return { ok: true, moves: moves, focus: focus, carry: destinationOf }
}

// ---- a window taking its new desktop's size first ------------------------------
// Hyprland gives a window moved to a desktop that isn't on screen its new
// size at once, but holds it there (xdg-shell's "suspended"): it draws
// nothing new until that desktop shows. It kept the picture it had, the
// Spaces bar and the opening desktop showed that, stretched, and the window
// drew itself at its new size only once there, in view. So a window going
// to a desktop of its own takes that size first, where it is, under the
// stage: maximized, which is the size Hyprland gives a window alone on a
// desktop. It draws itself, and goes (presized, planLua) the size it is
// there. One going to a desktop with windows has the size Hyprland splits
// off one of them, and that one shrinks too: there Hyprland shows that
// desktop for a moment, under the stage, and comes back (showFirstLua).
// Service.moveWindowToDesktop.

// Where window `address` will be alone on a desktop of its own (on its
// display, as localRect), if it should take that size first; else null.
// `desktop` is where it goes, 0 for a new desktop. Only a tiled window of
// the desktop on screen sharing it with others (alone it has that size
// already), going to a desktop on the same display with no tiled windows
// (with some, see showsFirst). Not one in a tab group, nor an XWayland one
// (Hyprland doesn't suspend those), nor while a window there is fullscreen
// (maximizing would take that away).
function presizeRect(snap, address, monitor, desktop) {
  if (!snap || !monitor || !isAddress(address)) return null
  var win = null
  for (var i = 0; i < snap.windows.length; i++) if (snap.windows[i].address === address) win = snap.windows[i]
  if (!win || win.monitor !== monitor.id || win.workspace !== monitor.activeWorkspace) return null
  if (win.floating || win.fullscreen !== 0 || win.pinned || win.hidden || win.special || win.grouped || win.xwayland) return null
  if (desktop === win.workspace) return null
  if (desktop > 0) {
    if (tiledOn(snap, desktop)) return null
    if (snap.workspaces.some(function(ws) { return ws.id === desktop && ws.monitor !== monitor.name })) return null
  }
  var here = snap.windows.filter(function(w) {
    return w.monitor === monitor.id && w.workspace === win.workspace && !w.hidden && !w.pinned
  })
  if (here.some(function(w) { return w.fullscreen !== 0 })) return null
  // The tiled windows fill the desktop but for its outer gaps: together
  // they take the room one window alone would.
  var tiled = here.filter(function(w) { return !w.floating })
  var left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  tiled.forEach(function(w) {
    left = Math.min(left, w.x)
    top = Math.min(top, w.y)
    right = Math.max(right, w.x + w.w)
    bottom = Math.max(bottom, w.y + w.h)
  })
  if (left === win.x && top === win.y && right === win.x + win.w && bottom === win.y + win.h) return null
  return localRect({ x: left, y: top, w: right - left, h: bottom - top }, monitor)
}

// Whether desktop `id` has windows Hyprland tiles (floating ones keep
// their size whatever comes).
function tiledOn(snap, id) {
  return snap.windows.some(function(w) { return w.workspace === id && !w.floating })
}

// Whether window `address` should go to desktop `desktop` with that desktop
// shown for a moment (showFirstLua): a tiled window of the desktop on
// screen going to a desktop of the same display that has tiled windows.
function showsFirst(snap, address, monitor, desktop) {
  if (!snap || !monitor || !isAddress(address) || !(desktop > 0)) return false
  var win = null
  for (var i = 0; i < snap.windows.length; i++) if (snap.windows[i].address === address) win = snap.windows[i]
  if (!win || win.monitor !== monitor.id || win.workspace !== monitor.activeWorkspace || desktop === win.workspace) return false
  if (win.floating || win.fullscreen !== 0 || win.pinned || win.hidden || win.special) return false
  var ws = null
  for (var j = 0; j < snap.workspaces.length; j++) if (snap.workspaces[j].id === desktop) ws = snap.workspaces[j]
  return !!ws && ws.monitor === monitor.name && tiledOn(snap, desktop)
}

// Lua for hyprctl eval that moves window `address` to desktop `desktop`
// and shows that desktop, where Hyprland lets its windows draw themselves
// at their new sizes, and `ms` later comes back to desktop `here` (on
// display `monitorId`). By way of the desktop it last came from, unless
// that's on another display: Hyprland's "previous desktop"
// (Super+Ctrl+Tab) stays the one it was.
function showFirstLua(address, desktop, here, monitorId, ms) {
  function whole(n) { return typeof n === "number" && isFinite(n) && Math.round(n) === n }
  if (!isAddress(address) || !whole(desktop) || !whole(here) || desktop <= 0 || here <= 0 || desktop >= 100000 || here >= 100000
      || desktop === here || !whole(monitorId) || monitorId < 0 || !whole(ms) || ms <= 0 || ms > 2000) return ""
  return [
    "local back = hl.get_last_workspace()",
    "local backId = back and back.id or 0",
    "local backHere = backId > 0 and backId ~= " + desktop + " and backId ~= " + here
      + " and not back.visible and back.monitor ~= nil and back.monitor.id == " + monitorId,
    "hl.dispatch(hl.dsp.window.move({ window = \"address:" + address + "\", workspace = \"" + desktop + "\", follow = false }))",
    "hl.dispatch(hl.dsp.focus({ workspace = \"" + desktop + "\" }))",
    "hl.timer(function()",
    "  if backHere then hl.dispatch(hl.dsp.focus({ workspace = tostring(backId) })) end",
    "  hl.dispatch(hl.dsp.focus({ workspace = \"" + here + "\" }))",
    "end, { timeout = " + ms + ", type = \"oneshot\" })"
  ].join("\n")
}

// Lua for hyprctl eval that maximizes window `address`, the first step of a
// presized move.
function presizeLua(address) {
  if (!isAddress(address)) return ""
  return "hl.dispatch(hl.dsp.window.fullscreen({ window = \"address:" + address + "\", mode = \"maximized\", action = \"set\" }))"
}

// Lua for hyprctl eval that performs moves in order, then focuses a
// workspace or a window. Every value is validated here; nothing else reaches
// the code. A presized move (presizeLua) ends the window's maximized state
// once it's there, alone at the size it already has: Hyprland sends it no
// new size.
function planLua(moves, focus, focusAddress) {
  var lines = []
  ;(moves || []).forEach(function(move) {
    var to = move.to
    if (!isAddress(move.address)) return
    if (typeof to !== "number" || !isFinite(to) || Math.round(to) !== to || to <= 0 || to >= 100000) return
    lines.push("hl.dispatch(hl.dsp.window.move({ window = \"address:" + move.address + "\", workspace = \"" + to + "\", follow = false }))")
    if (move.presized === true)
      lines.push("hl.dispatch(hl.dsp.window.fullscreen({ window = \"address:" + move.address + "\", mode = \"maximized\", action = \"unset\" }))")
  })
  if (typeof focus === "number" && focus > 0 && focus < 100000 && Math.round(focus) === focus)
    lines.push("hl.dispatch(hl.dsp.focus({ workspace = \"" + focus + "\" }))")
  if (isAddress(focusAddress))
    lines.push("hl.dispatch(hl.dsp.focus({ window = \"address:" + focusAddress + "\" }))")
  return lines.join("\n")
}

// ---- Hyprland going to another desktop under the stage -------------------------
// Hyprland animates going to another desktop, and a window's border when
// it gets the keys. Under the stage nobody sees it, but it can go on after
// the stage is gone: the stage closed on a desktop still sliding into
// place, or on a border still turning active. So the stage waits that long
// before it goes (Service.finishCloseWhenStill).

// How long Hyprland's workspace animation takes, in ms, from `hyprctl -j
// animations`: "workspaces" as it is, or as it takes it from "global", and
// workspacesIn and workspacesOut when set on their own (a speed of 1 is
// 100 ms). 0 when it's off, null when the list can't be read.
function workspaceAnimationMs(json) {
  var all = {}
  ;(Array.isArray(json) ? json : []).forEach(function(group) {
    ;(Array.isArray(group) ? group : []).forEach(function(a) {
      if (a && typeof a.name === "string") all[a.name] = a
    })
  })
  if (!all.workspaces || !all.global) return null
  var longest = 0
  function take(a) {
    var speed = Number(a.speed)
    if (a.enabled && speed > 0 && speed < 1000) longest = Math.max(longest, Math.round(speed * 100))
  }
  take(all.workspaces.overridden ? all.workspaces : all.global)
  ;["workspacesIn", "workspacesOut"].forEach(function(name) {
    if (all[name] && all[name].overridden) take(all[name])
  })
  return longest
}

// How long Hyprland takes to change a window's border, active to inactive
// and back: its "border" animation, as it is or as it takes it from
// "global". 0 when it's off, null when the list can't be read.
function borderAnimationMs(json) {
  var all = {}
  ;(Array.isArray(json) ? json : []).forEach(function(group) {
    ;(Array.isArray(group) ? group : []).forEach(function(a) {
      if (a && typeof a.name === "string") all[a.name] = a
    })
  })
  if (!all.border || !all.global) return null
  var a = all.border.overridden ? all.border : all.global
  var speed = Number(a.speed)
  return a.enabled && speed > 0 && speed < 1000 ? Math.round(speed * 100) : 0
}

// How long Hyprland takes to move or resize a window: its "windowsMove"
// animation, as it is or as it takes it from "windows", then "global". 0
// when it's off, null when the list can't be read.
function windowAnimationMs(json) {
  var all = {}
  ;(Array.isArray(json) ? json : []).forEach(function(group) {
    ;(Array.isArray(group) ? group : []).forEach(function(a) {
      if (a && typeof a.name === "string") all[a.name] = a
    })
  })
  if (!all.global) return null
  var a = all.windowsMove && all.windowsMove.overridden ? all.windowsMove
    : all.windows && all.windows.overridden ? all.windows : all.global
  var speed = Number(a.speed)
  return a.enabled && speed > 0 && speed < 1000 ? Math.round(speed * 100) : 0
}

// The desktop window `address` is on, when that desktop isn't on screen;
// else 0.
function hiddenDesktopOf(snap, address) {
  if (!snap || !isAddress(address)) return 0
  var w = null
  for (var i = 0; i < snap.windows.length; i++) if (snap.windows[i].address === address) w = snap.windows[i]
  if (!w || w.hidden || w.pinned || w.special) return 0
  var monitor = monitorById(snap, w.monitor)
  return monitor && w.workspace !== monitor.activeWorkspace && w.workspace !== monitor.specialWorkspace ? w.workspace : 0
}

// ---- which app a window belongs to ---------------------------------------------
// A window class doesn't always name its desktop entry. LocalSend's is
// org.localsend.localsend_app for localsend.desktop, and an Omarchy web app is
// a Chromium window with a class like chrome-app.hey.com__-Default whose entry
// runs "omarchy-launch-webapp https://..." (or a handler, for HEY and Zoom).
// The expressions live at module level so lookups don't allocate them.
var webAppClassRe = /^(?:chrome|chromium|brave|msedge|vivaldi|google-chrome)-([^_]+)__/i
var launchWebappRe = /omarchy-launch-webapp\s+["']?([^\s"']+)/
var appFlagRe = /--app=["']?([^\s"']+)/
var urlHostRe = /^[a-z][a-z0-9+.-]*:\/\/([^\/:?#]+)/i
var wwwRe = /^www\./i
var genericPartRe = /^(app|client|desktop|gui|ui)$/i
var genericSuffixRe = /[-_](app|client|desktop|gui|bin)$/i
var secondLevelRe = /^(co|com|net|org|gov|edu|ac)$/

// The site a web app window shows: "app.hey.com" for chrome-app.hey.com__-Default,
// "" for any other window (an extension's class has no "__").
function webAppHost(cls) {
  var match = String(cls || "").match(webAppClassRe)
  return match ? match[1].toLowerCase().replace(wwwRe, "") : ""
}

// The site a desktop entry's Exec line opens as a web app, or "".
function launchedSite(exec) {
  var text = String(exec || "")
  var match = text.match(launchWebappRe) || text.match(appFlagRe)
  var url = match ? match[1].match(urlHostRe) : null
  return url ? url[1].toLowerCase().replace(wwwRe, "") : ""
}

// A site's own name within its host: "hey" for app.hey.com, "bbc" for bbc.co.uk.
function siteName(host) {
  var labels = String(host || "").split(".")
  labels.pop()
  while (labels.length > 1 && secondLevelRe.test(labels[labels.length - 1])) labels.pop()
  return labels.length ? labels[labels.length - 1] : ""
}

// Names to look a window class up by, best first: the class itself; for a web
// app, its site's name; otherwise, for a reverse-DNS class, its app part, and
// the name without a generic suffix like "_app".
function appKeys(cls) {
  var key = String(cls || "")
  if (!key) return []
  var keys = [key]
  function add(name) { if (name && keys.indexOf(name) === -1) keys.push(name) }
  var host = webAppHost(key)
  if (host) {
    add(siteName(host))
    return keys
  }
  var parts = key.split(".").filter(function(part) { return part !== "" })
  var last = key
  if (parts.length >= 3) {
    last = parts[parts.length - 1]
    if (genericPartRe.test(last)) last = parts[parts.length - 2]
    add(last)
  }
  add(last.replace(genericSuffixRe, ""))
  return keys
}

// A readable name for an app with no desktop entry, from its window class:
// "org.gnome.Nautilus" -> "Nautilus", "herdr-gui" -> "Herdr Gui", and a web
// app's site.
function appName(cls) {
  var text = String(cls || "")
  var host = webAppHost(text)
  if (host) return host
  var last = text.split(".").filter(function(part) { return part !== "" }).pop() || text
  var words = last.split(/[-_ ]+/).filter(function(word) { return word !== "" })
  if (words.length === 0) return "Window"
  return words.map(function(word) { return word.charAt(0).toUpperCase() + word.slice(1) }).join(" ")
}

// Minimized windows (Title Bars keeps them on special:minimized).
function minimizedWindows(snap, cls) {
  return snap.windows.filter(function(w) {
    return w.workspaceName === "special:minimized" && (!cls || w.cls === cls)
  })
}

// Windows App Exposé shows for an app: on regular desktops, any monitor.
function appWindows(snap, cls) {
  return snap.windows.filter(function(w) {
    return !w.special && !w.hidden && w.cls === cls
  }).sort(function(a, b) { return a.focus - b.focus })
}
