// reelkit studio: the built video in the HyperFrames player over a timeline of every
// layer. Every edit is a whole new video.json sent to the server (PUT /api/video), which
// checks it like a build would, writes it and rebuilds; the page then reloads in place.

const FPS = 30
const $ = (id) => document.getElementById(id)
const player = $('player')

let data = null
let version = -1
let revision = ''
let choices = null
let time = 0
let playing = false
let pxPerSec = null // null = fit
let selected = null // { kind, key }: callouts by their index in video.json, the rest by number
/** Time to hold across a reload: the player fires `ready` (and resets to 0) more than once. */
let restoring = null
/** After an add, focus the new item's text field once the inspector shows it. */
let focusText = false
const history = { undo: [], redo: [] }

const r2 = (n) => Math.round(n * 100) / 100
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
const fmt = (t) => t.toFixed(2)
const lastFrame = () => Math.max(0, Math.floor((data?.total ?? 0) * FPS - 1e-6) / FPS)

// ── data ───────────────────────────────────────────────────────────
async function load() {
  const res = await fetch('/api/plan')
  const body = await res.json()
  showError(body.error)
  if (!body.data) return
  const first = !data
  data = body.data
  // Undo writes back a whole earlier video.json; after a change from elsewhere (Claude, an
  // editor) that would silently revert it, so the history starts over.
  if (!first && body.revision !== revision && (history.undo.length || history.redo.length)) {
    history.undo = []
    history.redo = []
    toast('video.json changed outside the studio — undo history cleared')
  }
  revision = body.revision
  choices = body.choices
  if (body.version !== version) {
    version = body.version
    reloadPlayer(first ? 0 : time)
  }
  renderAll()
}

function renderAll() {
  renderHeader()
  renderWarnings()
  renderTimeline()
  renderInspector()
  updateHistory()
}

function reloadPlayer(at) {
  restoring = at
  playing = false
  updatePlay()
  player.setAttribute('src', `/video/index.html?v=${version}`)
}

player.addEventListener('ready', () => {
  if (restoring === null) return
  time = Math.min(restoring, lastFrame())
  player.seek(time)
  updateTime()
})
player.addEventListener('timeupdate', (e) => {
  if (restoring !== null) return
  time = e.detail.currentTime
  // The runtime's clock can run past the composition; the video ends at its last frame.
  if (playing && time >= lastFrame()) {
    player.pause()
    seek(lastFrame())
    return
  }
  updateTime()
})
player.addEventListener('play', () => { restoring = null; playing = true; updatePlay() })
player.addEventListener('pause', () => { playing = false; updatePlay() })
player.addEventListener('ended', () => { playing = false; updatePlay() })

function connect() {
  const events = new EventSource('/api/events')
  events.onopen = () => setStatus('live', '')
  events.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.error) {
      showError(msg.error)
    } else if (msg.version !== version) {
      load()
    }
  }
  events.onerror = () => setStatus('studio stopped — rerun reelkit studio', 'offline')
}

// ── edits ──────────────────────────────────────────────────────────
/** Applies `mutate` to a copy of video.json and saves it. Resolves true once written. */
async function commit(label, mutate) {
  const before = structuredClone(data.spec)
  const next = structuredClone(before)
  mutate(next)
  tidy(next)
  if (JSON.stringify(next) === JSON.stringify(before)) {
    renderTimeline()
    return false
  }
  const ok = await save(next, label)
  if (ok) {
    history.undo.push({ spec: before, label })
    history.redo = []
    updateHistory()
  }
  return ok
}

async function save(spec, label) {
  setStatus('saving…', 'busy')
  let res, body
  try {
    res = await fetch('/api/video', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base: revision, spec }),
    })
    body = await res.json()
  } catch {
    toast('The studio is not answering — is it still running?', true)
    setStatus('studio stopped — rerun reelkit studio', 'offline')
    return false
  }
  if (!res.ok) {
    toast(body.error, true)
    if (res.status === 409) {
      await load()
    } else {
      setStatus('live', '')
      renderTimeline()
    }
    return false
  }
  revision = body.revision
  toast(body.error ? `${label} — saved, but the build failed` : `${label}${body.warnings?.length ? ` · ${body.warnings.length} warning(s)` : ''}`, !!body.error)
  await load()
  return true
}

/** Drops what would only be noise in video.json. */
function tidy(spec) {
  if (spec.trim && !Object.keys(spec.trim).length) delete spec.trim
  if (spec.sections && !Object.keys(spec.sections).length) delete spec.sections
  for (const c of spec.callouts ?? []) {
    if (c.offset !== undefined && Math.abs(c.offset) < 0.005) delete c.offset
  }
}

async function undo() {
  const step = history.undo.pop()
  if (!step) return
  const current = structuredClone(data.spec)
  if (await save(step.spec, `Undid: ${step.label}`)) {
    history.redo.push({ spec: current, label: step.label })
  } else {
    history.undo.push(step)
  }
  updateHistory()
}

async function redo() {
  const step = history.redo.pop()
  if (!step) return
  const current = structuredClone(data.spec)
  if (await save(step.spec, `Redid: ${step.label}`)) {
    history.undo.push({ spec: current, label: step.label })
  } else {
    history.redo.push(step)
  }
  updateHistory()
}

function updateHistory() {
  $('undo').disabled = !history.undo.length
  $('redo').disabled = !history.redo.length
  $('undo').title = history.undo.length ? `Undo: ${history.undo.at(-1).label} (⌘Z)` : 'Nothing to undo'
  $('redo').title = history.redo.length ? `Redo: ${history.redo.at(-1).label} (⇧⌘Z)` : 'Nothing to redo'
  const inRecording = data && time >= data.sections[1].start && time <= data.sections[1].end
  $('add-callout').disabled = !inRecording
}

/** Composition time → recording time (footage pauses while a hand-off card is on screen). */
function toRecording(t) {
  let seg = data.segments[0]
  for (const s of data.segments) if (t >= s.start) seg = s
  return r2(seg.mediaStart + clamp(t - seg.start, 0, seg.duration))
}

function addCalloutAt(t) {
  if (t < data.sections[1].start || t > data.sections[1].end) {
    toast('Callouts go over the recording — move the playhead into it first', true)
    return
  }
  const source = data.spec.callouts.length
  selected = { kind: 'callout', key: source }
  focusText = true
  commit('Added a callout', (spec) => spec.callouts.push({ at: toRecording(t), text: 'New step' }))
}

function removeSelected() {
  if (!selected) return
  if (selected.kind === 'callout') {
    const i = Number(selected.key)
    const c = data.spec.callouts[i]
    selected = null
    if (c) commit(`Deleted callout "${c.text}"`, (spec) => spec.callouts.splice(i, 1))
  } else if (selected.kind === 'zoom') {
    const i = Number(selected.key) - 1
    selected = null
    commit(`Deleted zoom ${i + 1}`, (spec) => spec.zooms.splice(i, 1))
  }
}

// ── playback ───────────────────────────────────────────────────────
function seek(t) {
  if (!data) return
  restoring = null
  time = clamp(t, 0, lastFrame())
  player.seek(time)
  updateTime()
}

function togglePlay() {
  if (playing) {
    player.pause()
  } else {
    if (time >= lastFrame() - 1e-3) seek(0)
    restoring = null
    player.play()
  }
}

function updatePlay() {
  $('play').textContent = playing ? '❚❚' : '▶︎'
}

function updateTime() {
  if (!data) return
  $('time').firstChild.textContent = `${fmt(time)} / ${fmt(data.total)}`
  $('time').querySelector('.frame').textContent = `frame ${Math.round(time * FPS)}`
  const head = document.querySelector('.playhead')
  if (head) {
    head.style.left = `${time * scale()}px`
    if (playing) follow()
  }
  const inRecording = time >= data.sections[1].start && time <= data.sections[1].end
  $('add-callout').disabled = !inRecording
}

/** Keep the playhead in view while playing. */
function follow() {
  const body = $('tl-body')
  const labelW = labelWidth()
  const x = time * scale() + labelW
  if (x < body.scrollLeft + labelW || x > body.scrollLeft + body.clientWidth - 40) {
    body.scrollLeft = x - labelW - 40
  }
}

// ── header, warnings ───────────────────────────────────────────────
function renderHeader() {
  document.title = `${data.title} · reelkit studio`
  $('title').textContent = data.title
  $('slug').textContent = data.slug
  const current = Object.fromEntries(data.sections.map((s) => [s.slot, s.name]))
  current.recap ??= 'none'
  const pick = (label, options, value, onChange) => {
    const chip = el('label', 'chip', `${label} `)
    chip.append(dropdown(options, value, onChange))
    return chip
  }
  $('design').replaceChildren(
    pick('template', choices.templates, data.template, (v) => commit(`Template: ${v}`, (spec) => { spec.template = v })),
    ...['intro', 'recap', 'outro'].map((slot) =>
      pick(slot, choices[slot], current[slot], (v) => commit(`${slot}: ${v}`, (spec) => { spec.sections = { ...spec.sections, [slot]: v } })),
    ),
  )
  $('viewer').classList.toggle('tall', data.frame.height > data.frame.width)
}

function renderWarnings() {
  const list = $('warnings')
  const items = [
    ...data.warnings.map((w) => ({ text: w, bad: false })),
    ...data.zooms.flatMap((z) => z.problems.map((p) => ({ text: `zoom ${z.n}: ${p}`, bad: true, select: { kind: 'zoom', key: z.n } }))),
  ]
  if (!items.length) {
    const ok = el('li', 'ok', 'None — ready to render.')
    list.replaceChildren(ok)
    return
  }
  list.replaceChildren(
    ...items.map((w) => {
      const li = el('li', w.bad ? 'bad' : '', w.text)
      if (w.select) {
        li.style.cursor = 'pointer'
        li.onclick = () => select(w.select.kind, w.select.key, true)
      }
      return li
    }),
  )
}

// ── timeline ───────────────────────────────────────────────────────
const LANES = [
  ['sections', 'Sections'],
  ['callouts', 'Callouts'],
  ['zooms', 'Zooms'],
  ['handOffs', 'Hand-offs'],
  ['clicks', 'Clicks'],
  ['markers', 'Markers'],
  ['audio', 'Audio'],
]

function labelWidth() {
  return $('labels').getBoundingClientRect().width
}

function fitScale() {
  const w = $('tl-body').clientWidth - labelWidth() - 16
  return Math.max(10, w / data.total)
}

function scale() {
  return pxPerSec ?? fitScale()
}

function el(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

function span(node, start, end) {
  const s = scale()
  node.style.left = `${start * s}px`
  node.style.width = `${Math.max(3, (end - start) * s)}px`
  return node
}

function hover(node, text) {
  node.addEventListener('mouseenter', () => { const tip = $('tooltip'); tip.textContent = text; tip.style.display = 'block' })
  node.addEventListener('mousemove', (e) => { const tip = $('tooltip'); tip.style.left = `${e.clientX + 12}px`; tip.style.top = `${e.clientY - 30}px` })
  node.addEventListener('mouseleave', () => { $('tooltip').style.display = 'none' })
}

const isSelected = (kind, key) => selected && selected.kind === kind && String(selected.key) === String(key)

/**
 * An item that selects (and seeks to `at`) on click. With `drag`, it can also be dragged:
 * `drag.modes` lists 'move', 'start' and/or 'end' (the edges are 6 px handles);
 * `drag.preview(mode, ds)` redraws it while dragging, `drag.drop(mode, ds)` saves.
 */
function pickable(node, kind, key, at, drag) {
  node.dataset.kind = kind
  node.dataset.key = key
  if (isSelected(kind, key)) node.classList.add('selected')
  const modeAt = (e) => {
    if (!drag) return null
    const rect = node.getBoundingClientRect()
    const x = e.clientX - rect.left
    const edge = Math.min(6, rect.width / 3)
    if (drag.modes.includes('start') && x <= edge) return 'start'
    if (drag.modes.includes('end') && x >= rect.width - edge) return 'end'
    return drag.modes.includes('move') ? 'move' : null
  }
  if (drag) {
    node.classList.add('editable')
    node.addEventListener('pointermove', (e) => {
      if (e.buttons) return
      const mode = modeAt(e)
      node.style.cursor = mode === 'start' || mode === 'end' ? 'ew-resize' : mode === 'move' ? 'grab' : 'pointer'
    })
  }
  node.addEventListener('pointerdown', (e) => {
    // Items select or drag instead of scrubbing.
    e.stopPropagation()
    if (e.button !== 0) return
    $('tooltip').style.display = 'none'
    const mode = modeAt(e)
    const x0 = e.clientX
    let ds = 0
    let moved = false
    try { node.setPointerCapture(e.pointerId) } catch { /* synthetic events */ }
    const onMove = (m) => {
      if (!mode) return
      if (!moved && Math.abs(m.clientX - x0) < 3) return
      if (!moved) {
        moved = true
        if (playing) player.pause()
        node.classList.add('dragging')
      }
      ds = Math.round(((m.clientX - x0) / scale()) * FPS) / FPS
      ds = drag.snap ? drag.snap(mode, ds) : ds
      drag.preview(mode, ds)
    }
    const onUp = () => {
      node.removeEventListener('pointermove', onMove)
      node.removeEventListener('pointerup', onUp)
      node.removeEventListener('pointercancel', onUp)
      if (moved) {
        node.classList.remove('dragging')
        if (Math.abs(ds) >= 1 / FPS) {
          selected = { kind, key }
          drag.drop(mode, ds)
        } else {
          renderTimeline()
        }
        return
      }
      if (playing) player.pause()
      select(kind, key, false)
      seek(at)
    }
    node.addEventListener('pointermove', onMove)
    node.addEventListener('pointerup', onUp)
    node.addEventListener('pointercancel', onUp)
  })
  return node
}

/** Snaps a dragged time onto a marker, a click or the playhead when within 6 px. */
function snapTo(t) {
  const targets = [time, ...data.markers.map((m) => m.at), ...data.clicks.map((c) => c.at)]
  const px = 6 / scale()
  let best = t
  let bestD = px
  for (const target of targets) {
    const d = Math.abs(target - t)
    if (d < bestD) { best = target; bestD = d }
  }
  return best
}

function renderTimeline() {
  const s = scale()
  const width = data.total * s
  $('labels').replaceChildren(el('div', 'ruler-label', ''), ...LANES.map(([, label]) => el('div', '', label)))
  const tracks = $('tracks')
  tracks.style.width = `${width}px`
  $('tl-inner').style.width = `${width + labelWidth() + 16}px`

  // Ruler: a labelled tick every `step` seconds, minor ticks between.
  const ruler = el('div', 'ruler')
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60].find((st) => st * s >= 60) ?? 60
  for (let t = 0; t <= data.total + 1e-6; t += step / 2) {
    const major = Math.abs(t / step - Math.round(t / step)) < 1e-6
    const tick = el('div', major ? 'tick' : 'tick minor')
    tick.style.left = `${t * s}px`
    if (major) tick.append(el('span', '', `${+t.toFixed(1)}s`))
    ruler.append(tick)
  }

  const lanes = Object.fromEntries(LANES.map(([key]) => [key, el('div', 'lane')]))

  for (const sec of data.sections) {
    const node = span(el('div', `item ${sec.slot}`, sec.slot === 'recording' ? 'recording' : `${sec.slot} · ${sec.name}`), sec.start, sec.end)
    let drag
    if (sec.slot === 'recording') {
      hover(node, `recording: ${fmt(sec.start)}–${fmt(sec.end)}s ${sec.detail} — drag an edge to trim`)
      drag = {
        modes: ['start', 'end'],
        preview: (mode, ds) => (mode === 'start' ? span(node, sec.start + ds, sec.end) : span(node, sec.start, sec.end + ds)),
        drop: (mode, ds) => {
          const { start, end, duration } = data.media
          if (mode === 'start') {
            const next = clamp(r2(start + ds), 0, end - 1)
            commit(`Trim start: ${next}s`, (spec) => {
              spec.trim = { ...spec.trim, start: next }
              if (next === 0) delete spec.trim.start
            })
          } else {
            const next = clamp(r2(end + ds), start + 1, duration)
            commit(`Trim end: ${next >= duration - 0.01 ? 'the end' : `${next}s`}`, (spec) => {
              spec.trim = { ...spec.trim, end: next }
              if (next >= duration - 0.01) delete spec.trim.end
            })
          }
        },
      }
    } else {
      hover(node, `${sec.slot} "${sec.name}": ${fmt(sec.start)}–${fmt(sec.end)}s ${sec.detail}`)
    }
    lanes.sections.append(pickable(node, 'section', sec.slot, sec.start, drag))
  }

  data.callouts.forEach((c, i) => {
    // An overlap is already a warning; outline both callouts so it shows where.
    const overlaps = (a, b) => a && b && a.end > b.at + 0.01
    const bad = overlaps(c, data.callouts[i + 1]) || overlaps(data.callouts[i - 1], c)
    const node = span(el('div', `item callout${bad ? ' bad' : ''}`, `${c.n} ${c.text}`), c.at, c.end)
    hover(node, `${c.n}. ${c.text} (${fmt(c.at)}–${fmt(c.end)}s)${bad ? ' — overlaps a neighbour' : ''} — drag to move, drag the right edge to resize`)
    lanes.callouts.append(pickable(node, 'callout', c.source, c.at, {
      modes: ['move', 'end'],
      snap: (mode, ds) => (mode === 'move' ? snapTo(c.at + ds) - c.at : snapTo(c.end + ds) - c.end),
      preview: (mode, ds) => (mode === 'move' ? span(node, c.at + ds, c.end + ds) : span(node, c.at, Math.max(c.at + 0.5, c.end + ds))),
      drop: (mode, ds) => {
        if (mode === 'move') {
          const delta = r2(toRecording(c.at + ds) - toRecording(c.at))
          commit(`Moved callout ${c.n} ${delta > 0 ? '+' : ''}${delta}s`, (spec) => {
            const src = spec.callouts[c.source]
            if (src.marker !== undefined) src.offset = r2((src.offset ?? 0) + delta)
            else src.at = Math.max(0, r2(src.at + delta))
          })
        } else {
          const length = Math.max(0.5, r2(c.end - c.at + ds))
          commit(`Callout ${c.n} length: ${length}s`, (spec) => { spec.callouts[c.source].duration = length })
        }
      },
    }))
  })

  for (const z of data.zooms) {
    const node = span(el('div', `item zoom${z.problems.length ? ' bad' : ''}`), z.at, z.end)
    const dur = z.end - z.at
    const a = (z.in / dur) * 100
    const b = 100 - (z.out / dur) * 100
    node.innerHTML = `<svg viewBox="0 0 100 20" preserveAspectRatio="none"><polygon points="0,20 ${a},2 ${b},2 100,20" fill="color-mix(in srgb, var(--zoom) 55%, transparent)" stroke="var(--zoom)" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>`
    node.append(el('span', '', `${z.scale}×`))
    const src = data.spec.zooms?.[z.n - 1]
    const manual = src && !src.clicks
    hover(node, `zoom ${z.n}: ${z.scale}× at ${z.x}, ${z.y} · ${fmt(z.at)}–${fmt(z.end)}s (in ${z.in}s, out ${z.out}s)${manual ? ' — drag to move, drag an edge to resize' : ' — timed from its clicks'}`)
    lanes.zooms.append(pickable(node, 'zoom', z.n, z.at, manual ? {
      modes: ['move', 'start', 'end'],
      preview: (mode, ds) => span(node, mode === 'end' ? z.at : z.at + ds, mode === 'start' ? z.end : z.end + ds),
      drop: (mode, ds) => commit(`${mode === 'move' ? 'Moved' : 'Resized'} zoom ${z.n}`, (spec) => {
        const zoom = spec.zooms[z.n - 1]
        if (mode !== 'end') zoom.at = Math.max(0, r2(toRecording(z.at + ds)))
        if (mode === 'start') zoom.duration = Math.max(1, r2(zoom.duration - ds))
        if (mode === 'end') zoom.duration = Math.max(1, r2(zoom.duration + ds))
      }),
    } : undefined))
  }

  data.handOffs.forEach((h, i) => {
    lanes.handOffs.append(span(el('div', 'belt'), h.at - h.belt, h.at))
    const node = span(el('div', 'item handoff', h.title), h.at, h.end)
    hover(node, `hand-off: ${h.title}${h.from ? ` (${h.from} → ${h.to})` : ''} · ${fmt(h.at)}–${fmt(h.end)}s`)
    lanes.handOffs.append(pickable(node, 'handoff', i + 1, h.at - h.belt))
  })

  for (const c of data.clicks) {
    if (c.at > c.glide) lanes.clicks.append(span(el('div', 'glide'), c.glide, c.at))
    if (c.kind === 'type' && c.until > c.at) lanes.clicks.append(span(el('div', 'typing'), c.at, c.until))
    const dot = el('div', `dot ${c.kind}`)
    dot.style.left = `${c.at * s}px`
    hover(dot, `${c.kind} #${c.n} at ${fmt(c.at)}s${c.kind === 'type' ? ` (typing until ${fmt(c.until)}s)` : ''}, glide from ${fmt(c.glide)}s`)
    lanes.clicks.append(pickable(dot, 'click', c.n, c.at))
  }

  data.markers.forEach((m, i) => {
    const pin = el('div', `pin${m.used ? '' : ' unused'}`)
    pin.style.left = `${m.at * s}px`
    hover(pin, `marker "${m.label}" at ${fmt(m.at)}s (recording ${fmt(m.recordingAt)}s)${m.used ? '' : ' — no callout uses it'}`)
    lanes.markers.append(pickable(pin, 'marker', i + 1, m.at))
  })

  const audio = [['narration', data.audio.narration], ['music', data.audio.music]].filter(([, a]) => a)
  audio.forEach(([name, a], i) => {
    const node = span(el('div', `item audio${audio.length > 1 ? ' half' : ''}`, name), a.start, a.end)
    if (audio.length > 1) node.style.top = i ? '15px' : '4px'
    lanes.audio.append(pickable(node, 'audio', name, a.start))
  })
  if (!audio.length) {
    const none = el('div', 'hint lane-note', 'no narration, no music')
    lanes.audio.append(none)
  }

  tracks.replaceChildren(ruler, ...Object.values(lanes), el('div', 'playhead'))
  updateTime()
}

// Scrub: pointer down + drag anywhere on the tracks (items select instead).
let scrubbing = false
function timeAt(e) {
  const rect = $('tracks').getBoundingClientRect()
  return (e.clientX - rect.left) / scale()
}
$('tracks').addEventListener('pointerdown', (e) => {
  if (!data) return
  scrubbing = true
  $('tracks').setPointerCapture(e.pointerId)
  if (playing) player.pause()
  seek(timeAt(e))
})
$('tracks').addEventListener('pointermove', (e) => { if (scrubbing) seek(timeAt(e)) })
$('tracks').addEventListener('pointerup', () => { scrubbing = false })

function setZoom(next) {
  const body = $('tl-body')
  const center = (body.scrollLeft + body.clientWidth / 2 - labelWidth()) / scale()
  pxPerSec = next
  renderTimeline()
  body.scrollLeft = center * scale() - body.clientWidth / 2 + labelWidth()
}
$('zoom-in').onclick = () => setZoom(scale() * 1.5)
$('zoom-out').onclick = () => setZoom(scale() / 1.5 <= fitScale() ? null : scale() / 1.5)
$('zoom-fit').onclick = () => setZoom(null)
$('tl-body').addEventListener('wheel', (e) => {
  if (!(e.ctrlKey || e.metaKey) || !data) return
  e.preventDefault()
  const next = scale() * (e.deltaY < 0 ? 1.15 : 1 / 1.15)
  setZoom(next <= fitScale() ? null : next)
}, { passive: false })
new ResizeObserver(() => { if (data && pxPerSec === null) renderTimeline() }).observe($('tl-body'))

// ── inspector ──────────────────────────────────────────────────────
function select(kind, key, andSeek) {
  selected = { kind, key }
  document.querySelectorAll('.selected').forEach((n) => n.classList.remove('selected'))
  document.querySelectorAll(`[data-kind="${kind}"][data-key="${key}"]`).forEach((n) => n.classList.add('selected'))
  renderInspector()
  if (andSeek) {
    const at = seekTarget()
    if (at !== undefined) seek(at)
  }
}

function seekTarget() {
  const { kind, key } = selected
  const k = String(key)
  if (kind === 'section') return data.sections.find((x) => x.slot === k)?.start
  if (kind === 'callout') return data.callouts.find((x) => String(x.source) === k)?.at
  if (kind === 'zoom') return data.zooms.find((x) => String(x.n) === k)?.at
  return undefined
}

// Form controls: each saves on change (Enter or leaving the field).
function textInput(value, onSave, placeholder = '') {
  const input = el('input')
  input.type = 'text'
  input.value = value ?? ''
  input.placeholder = placeholder
  input.addEventListener('change', () => onSave(input.value.trim()))
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = value ?? ''; input.blur() } })
  return input
}

function numberInput(value, onSave, { step = 0.1, min, max, placeholder = '' } = {}) {
  const input = el('input')
  input.type = 'number'
  input.step = String(step)
  if (min !== undefined) input.min = String(min)
  if (max !== undefined) input.max = String(max)
  input.value = value ?? ''
  input.placeholder = placeholder
  input.addEventListener('change', () => onSave(input.value === '' ? undefined : r2(Number(input.value))))
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur() })
  return input
}

function dropdown(options, value, onChange) {
  const sel = el('select')
  for (const o of options) {
    const opt = el('option', '', o)
    opt.value = o
    sel.append(opt)
  }
  sel.value = value
  sel.addEventListener('change', () => onChange(sel.value))
  return sel
}

function button(label, onClick, cls = '') {
  const b = el('button', cls, label)
  b.type = 'button'
  b.onclick = onClick
  return b
}

let inspected = ''

function renderInspector() {
  const box = $('inspector')
  // A rebuild redraws the panel; keep the field being typed in (and what is typed) when it
  // still shows the same item.
  const key = selected ? `${selected.kind}:${selected.key}` : ''
  const fields = () => [...box.querySelectorAll('input, select')]
  const active = key === inspected ? fields().indexOf(document.activeElement) : -1
  const typed = active >= 0 ? document.activeElement.value : null
  inspected = key
  const view = selected && data ? inspect(selected.kind, String(selected.key)) : null
  if (!view) {
    box.replaceChildren(el('p', 'empty', 'Click an item on the timeline.'))
    return
  }
  const kind = el('span', 'kind', view.label)
  kind.style.background = view.color
  const dl = el('dl')
  for (const [k, v] of view.rows) {
    if (v === null || v === undefined || v === '') continue
    dl.append(el('dt', '', k), typeof v === 'string' ? el('dd', '', v) : wrap('dd', v))
  }
  const actions = el('div', 'actions')
  actions.append(...(view.actions ?? []))
  box.replaceChildren(kind, dl, ...(view.problems ?? []).map((p) => el('p', 'problem', p)), ...(view.note ? [el('p', 'note', view.note)] : []), actions)
  if (focusText) {
    focusText = false
    const input = box.querySelector('input[type=text]')
    input?.focus()
    input?.select()
  } else if (active >= 0) {
    const field = fields()[active]
    if (field) {
      field.value = typed
      field.focus()
    }
  }
}

function wrap(tag, child) {
  const node = el(tag)
  node.append(child)
  return node
}

function inspect(kind, k) {
  const spec = data.spec
  if (kind === 'section') {
    const s = data.sections.find((x) => x.slot === k)
    if (!s) return null
    const base = [['from', `${fmt(s.start)}s`], ['to', `${fmt(s.end)}s`], ['length', `${fmt(s.end - s.start)}s`]]
    const pickSection = (slot, value) => dropdown(choices[slot], value, (v) => commit(`${slot}: ${v}`, (sp) => { sp.sections = { ...sp.sections, [slot]: v } }))
    if (s.slot === 'intro') {
      return { label: 'intro', color: 'var(--intro)', rows: [
        ['section', pickSection('intro', s.name)],
        ['title', textInput(spec.title, (v) => v ? commit('Title', (sp) => { sp.title = v }) : (toast('The title cannot be empty', true), renderInspector()))],
        ['subtitle', textInput(spec.subtitle, (v) => commit('Subtitle', (sp) => { if (v) sp.subtitle = v; else delete sp.subtitle }), 'none')],
        ...base, ['', s.detail],
      ] }
    }
    if (s.slot === 'recording') {
      const { start, end, duration } = data.media
      return { label: 'recording', color: 'var(--recording)', note: 'Drag the recording’s edges on the timeline to trim.', rows: [
        ['trim start', numberInput(spec.trim?.start, (v) => commit('Trim start', (sp) => { sp.trim = { ...sp.trim, start: v }; if (!v) delete sp.trim.start }), { min: 0, max: end - 1, placeholder: '0' })],
        ['trim end', numberInput(spec.trim?.end, (v) => commit('Trim end', (sp) => { sp.trim = { ...sp.trim, end: v }; if (v === undefined || v >= duration) delete sp.trim.end }), { min: start + 1, max: duration, placeholder: `${duration} (the end)` })],
        ['uses', `${fmt(start)}–${fmt(end)}s of ${fmt(duration)}s`],
        ...base,
      ] }
    }
    if (s.slot === 'recap') {
      return { label: 'recap', color: 'var(--recap)', rows: [
        ['section', pickSection('recap', s.name)],
        ['title', textInput(spec.recapTitle, (v) => commit('Recap title', (sp) => { if (v) sp.recapTitle = v; else delete sp.recapTitle }), 'from demo.config.json')],
        ...base, ['', s.detail],
      ] }
    }
    return { label: 'outro', color: 'var(--outro)', rows: [['section', pickSection('outro', s.name)], ...base] }
  }

  if (kind === 'callout') {
    const c = data.callouts.find((x) => String(x.source) === k)
    const src = spec.callouts[Number(k)]
    if (!src) return null
    if (!c) {
      return { label: 'callout (dropped)', color: 'var(--bad)', note: 'This callout is outside the trim window, so the video leaves it out.', rows: [['text', src.text]], actions: [button('Delete', removeSelected, 'danger')] }
    }
    const rows = [
      ['text', textInput(src.text, (v) => v ? commit(`Callout ${c.n} text`, (sp) => { sp.callouts[c.source].text = v }) : (toast('A callout needs text — delete it instead', true), renderInspector()))],
    ]
    if (src.marker !== undefined) {
      rows.push(['marker', src.marker])
      rows.push(['offset', numberInput(src.offset, (v) => commit(`Callout ${c.n} offset`, (sp) => { if (v) sp.callouts[c.source].offset = v; else delete sp.callouts[c.source].offset }), { step: 0.1, placeholder: '0 (on the marker)' })])
    } else {
      rows.push(['at', numberInput(src.at, (v) => v !== undefined && commit(`Callout ${c.n} time`, (sp) => { sp.callouts[c.source].at = Math.max(0, v) }), { min: 0, placeholder: 'recording seconds' })])
    }
    rows.push(['length', numberInput(src.duration, (v) => commit(`Callout ${c.n} length`, (sp) => { if (v) sp.callouts[c.source].duration = Math.max(0.5, v); else delete sp.callouts[c.source].duration }), { min: 0.5, placeholder: `auto (${fmt(c.end - c.at)}s)` })])
    if (data.handOffs.length || src.group) {
      rows.push(['role', textInput(src.group, (v) => commit(`Callout ${c.n} role`, (sp) => { if (v) sp.callouts[c.source].group = v; else delete sp.callouts[c.source].group }), c.group ?? 'from the hand-off cards')])
    }
    rows.push(['on screen', `${fmt(c.at)}–${fmt(c.end)}s`])
    return { label: `callout ${c.n}`, color: 'var(--callout)', rows, actions: [
      ...(src.offset ? [button('Snap to marker', () => commit(`Callout ${c.n} back on its marker`, (sp) => { delete sp.callouts[c.source].offset }))] : []),
      button('Delete', removeSelected, 'danger'),
    ] }
  }

  if (kind === 'zoom') {
    const z = data.zooms.find((x) => String(x.n) === k)
    const src = spec.zooms?.[Number(k) - 1]
    if (!z || !src) return null
    const set = (label, key, v) => commit(`Zoom ${z.n} ${label}`, (sp) => { if (v === undefined) delete sp.zooms[z.n - 1][key]; else sp.zooms[z.n - 1][key] = v })
    const rows = [['scale', numberInput(src.scale, (v) => v && set('scale', 'scale', clamp(v, 1.1, 4)), { min: 1.1, max: 4, step: 0.1 })]]
    if (src.clicks) {
      const numbers = data.clicks.map((c) => String(c.n))
      const [a, b = a] = src.clicks
      const setClicks = (first, last) => set('clicks', 'clicks', first === last ? [first] : [first, last])
      rows.push(['first click', dropdown(numbers, String(a), (v) => setClicks(Number(v), Math.max(Number(v), b)))])
      rows.push(['last click', dropdown(numbers, String(b), (v) => setClicks(Math.min(a, Number(v)), Number(v)))])
    } else {
      rows.push(['at', numberInput(src.at, (v) => v !== undefined && set('time', 'at', Math.max(0, v)), { min: 0, placeholder: 'recording seconds' })])
      rows.push(['length', numberInput(src.duration, (v) => v && set('length', 'duration', Math.max(1, v)), { min: 1 })])
    }
    rows.push(['focus x', numberInput(src.x, (v) => set('focus', 'x', v === undefined ? undefined : clamp(v, 0, 1)), { min: 0, max: 1, step: 0.01, placeholder: `auto (${z.x})` })])
    rows.push(['focus y', numberInput(src.y, (v) => set('focus', 'y', v === undefined ? undefined : clamp(v, 0, 1)), { min: 0, max: 1, step: 0.01, placeholder: `auto (${z.y})` })])
    rows.push(['ease in', numberInput(src.in, (v) => set('ease', 'in', v === undefined ? undefined : Math.max(0.4, v)), { min: 0.4, placeholder: `${z.in}s` })])
    rows.push(['ease out', numberInput(src.out, (v) => set('ease', 'out', v === undefined ? undefined : Math.max(0.4, v)), { min: 0.4, placeholder: `${z.out}s` })])
    rows.push(['on screen', `${fmt(z.at)}–${fmt(z.end)}s`])
    return { label: `zoom ${z.n}`, color: 'var(--zoom)', problems: z.problems, rows, actions: [button('Delete', removeSelected, 'danger')],
      note: src.clicks ? 'Timed from its clicks: the zoom rides along with the cursor.' : 'Manual zoom: drag it on the timeline.' }
  }

  if (kind === 'handoff') {
    const h = data.handOffs[Number(k) - 1]
    return h && { label: 'hand-off', color: 'var(--handoff)', note: 'Hand-off cards come from the recording (demo.handOff in the scenario).', rows: [
      ['title', h.title], ['subtitle', h.subtitle], ['roles', h.from ? `${h.from} → ${h.to}` : ''],
      ['belt out', `${fmt(h.at - h.belt)}s`], ['card in', `${fmt(h.at)}s`], ['holds to', `${fmt(h.end)}s`],
    ] }
  }

  if (kind === 'click') {
    const c = data.clicks.find((x) => String(x.n) === k)
    if (!c) return null
    const zoomed = (spec.zooms ?? []).findIndex((z) => z.clicks && c.n >= z.clicks[0] && c.n <= (z.clicks[1] ?? z.clicks[0]))
    return { label: `${c.kind} #${c.n}`, color: 'var(--click)', rows: [
      ['glide from', `${fmt(c.glide)}s`], [c.kind, `${fmt(c.at)}s`], ['typing to', c.kind === 'type' ? `${fmt(c.until)}s` : ''],
      ['zoom', zoomed >= 0 ? `zoom ${zoomed + 1}` : 'none'],
    ], actions: [
      zoomed >= 0
        ? button(`Select zoom ${zoomed + 1}`, () => select('zoom', zoomed + 1, true))
        : button('Zoom on this click', () => {
            selected = { kind: 'zoom', key: (spec.zooms?.length ?? 0) + 1 }
            commit(`Zoom on ${c.kind} #${c.n}`, (sp) => { sp.zooms = [...(sp.zooms ?? []), { clicks: [c.n], scale: 1.7 }] })
          }),
      button('Callout here', () => addCalloutAt(c.glide)),
    ] }
  }

  if (kind === 'marker') {
    const m = data.markers[Number(k) - 1]
    if (!m) return null
    const source = spec.callouts.findIndex((c) => c.marker === m.label)
    return { label: 'marker', color: 'var(--marker)', rows: [
      ['label', m.label], ['at', `${fmt(m.at)}s`], ['recording', `${fmt(m.recordingAt)}s`], ['callout', source >= 0 ? 'yes' : 'none uses it'],
    ], actions: [
      source >= 0
        ? button('Select its callout', () => select('callout', source, true))
        : button('Add a callout', () => {
            selected = { kind: 'callout', key: spec.callouts.length }
            focusText = true
            commit(`Callout on "${m.label}"`, (sp) => sp.callouts.push({ marker: m.label, text: m.label }))
          }),
    ] }
  }

  if (kind === 'audio') {
    const a = data.audio[k]
    return a && { label: k, color: 'var(--audio)', note: k === 'music' ? 'Music: demo.config.json music.file, or "music" in video.json.' : 'Narration: the recording’s own audio track.', rows: [['from', `${fmt(a.start)}s`], ['to', `${fmt(a.end)}s`]] }
  }
  return null
}

// ── status, keys ───────────────────────────────────────────────────
function setStatus(text, cls) {
  $('status').textContent = text
  $('status').className = `status ${cls}`
}

function showError(error) {
  $('banner').textContent = error ? `Build failed — showing the last good build.\n${error}` : ''
  $('banner').classList.toggle('show', !!error)
  setStatus(error ? 'build failed' : 'live', error ? 'error' : '')
}

let toastTimer
function toast(text, bad = false) {
  const node = $('toast')
  node.textContent = text
  node.className = `toast show${bad ? ' bad' : ''}`
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { node.className = 'toast' }, bad ? 8000 : 3500)
}

/** Every start/end on the timeline, for [ and ]. */
function edges() {
  const all = [
    0, data.total,
    ...data.sections.flatMap((s) => [s.start, s.end]),
    ...data.callouts.flatMap((c) => [c.at, c.end]),
    ...data.zooms.flatMap((z) => [z.at, z.at + z.in, z.end - z.out, z.end]),
    ...data.handOffs.flatMap((h) => [h.at - h.belt, h.at, h.end]),
    ...data.clicks.map((c) => c.at),
    ...data.markers.map((m) => m.at),
  ]
  return [...new Set(all.map((t) => Math.round(t * 1000) / 1000))].sort((a, b) => a - b)
}

document.addEventListener('keydown', (e) => {
  if (!data || (e.target instanceof Element && e.target.closest('input, textarea, select'))) return
  const mod = e.metaKey || e.ctrlKey
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return }
  if (mod) return
  const big = e.shiftKey ? 1 : 1 / FPS
  switch (e.key) {
    case ' ': e.preventDefault(); togglePlay(); break
    case 'ArrowLeft': e.preventDefault(); seek(time - big); break
    case 'ArrowRight': e.preventDefault(); seek(time + big); break
    case 'Home': seek(0); break
    case 'End': seek(lastFrame()); break
    case '[': { const prev = edges().filter((t) => t < time - 1e-3).at(-1); if (prev !== undefined) seek(prev); break }
    case ']': { const next = edges().find((t) => t > time + 1e-3); if (next !== undefined) seek(next); break }
    case '+': case '=': $('zoom-in').click(); break
    case '-': $('zoom-out').click(); break
    case '0': setZoom(null); break
    case 'm': case 'M': $('mute').click(); break
    case 'c': case 'C': addCalloutAt(time); break
    case 'Delete': case 'Backspace': e.preventDefault(); removeSelected(); break
    case 'Escape': selected = null; renderTimeline(); renderInspector(); break
  }
})

$('play').onclick = togglePlay
$('start').onclick = () => seek(0)
$('end').onclick = () => seek(lastFrame())
$('back').onclick = () => seek(time - 1 / FPS)
$('fwd').onclick = () => seek(time + 1 / FPS)
$('undo').onclick = undo
$('redo').onclick = redo
$('add-callout').onclick = () => addCalloutAt(time)
$('mute').onclick = () => {
  player.muted = !player.muted
  $('mute').textContent = player.muted ? '🔇' : '🔊'
}

load().then(connect)
