// Form — a declarative form built from fields.
//
// Give it an ordered list of fields; it owns focus movement between them (via
// bare-tui's focus ring), validation, and submission, and renders the whole
// thing. Fields may be field instances (form.text({…})) or plain definition
// objects with a `type` (`{ type: 'text', name: 'email' }`) — the latter is the
// shape the JSON-Schema mapper emits, so both paths converge here.
//
// NESTED OBJECTS. A field def may be an object section
// ({ type: 'object', name, optional, fields: [...] }); the form *flattens* these
// into a flat, depth-first list of focusable fields — each carrying its `path`
// (['address','street']) — plus a render `layout` with section headers and
// indentation. value()/setValues()/errors() walk the paths to produce/consume
// the nested object. A non-required (`optional`) section gets a checkbox gate.
//
// DYNAMIC FIELD SETS (oneOf/anyOf/if-then-else). A field (and its layout item)
// may carry an `_activeWhen()` predicate — a closure over controlling field
// instances. Inactive fields are hidden, unfocusable, uncollected, unvalidated.
// The form recomputes the active set on every keystroke and re-drives the ring.
//
// ARRAYS OF OBJECTS ({ type: 'array', itemFields, minItems, maxItems }). The set
// of fields can change *size* at runtime. Each array tracks an ordered list of
// entry *ids* (stable identity, independent of position); positions derive paths
// (contacts.0.name). _build() expands every array's entries and reuses field
// instances from a cache keyed by (arrayPath, entryId, subPath), so add / remove
// preserve each entry's values and shift the rest cleanly. Add/remove are
// focusable buttons (fields/action.js); the form mutates the id list and
// rebuilds. value() materializes real arrays.
//
// Keys (all configurable via the `keys` option — see defaultKeys): enter
// confirms the focused field and advances / activates a button — it never
// submits. A dedicated `submit` key (default ctrl+s) commits the form, so a form
// ending in an array's "+ Add" button can't be submitted by accident. When the
// body is taller than the terminal the form scrolls, keeping the focused field
// in view. The form never calls quit; it emits 'form.submit' / 'form.cancel' and
// the host (or run()) decides what they mean.
const { Program, quit, batch, key, spinner } = require('bare-tui')
const focus = require('bare-tui').focus

const FRAME_SETS = { dots: spinner.dots, line: spinner.line, points: spinner.points }

const { text } = require('./fields/text')
const { textarea } = require('./fields/textarea')
const { number } = require('./fields/number')
const { select } = require('./fields/select')
const { radio } = require('./fields/radio')
const { confirm } = require('./fields/confirm')
const { multiselect } = require('./fields/multiselect')
const { constant } = require('./fields/constant')
const { action } = require('./fields/action')
const { SectionToggleField } = require('./fields/section')
const { Field } = require('./fields/base')
const theme = require('./theme')

const emit = (msg) => () => msg
const always = () => true

// Form-level keybindings. Every action is an array of chords; pass a partial
// `keys` to form.create() to override individual ones (merged over these).
//
// Submit is deliberately NOT enter: enter confirms a field / activates a button
// / advances, and a separate `submit` chord commits the form — so a form that
// ends in an array's "+ Add" button can't be submitted by accident. The default
// submit is ctrl+s rather than a modifier+enter because most terminals can't
// tell ctrl/shift+enter from a plain enter (all arrive as \r); bind it to
// ['alt+enter'] etc. if your terminal supports distinguishing it.
const defaultKeys = {
  submit: ['ctrl+s'], // commit the whole form
  cancel: ['ctrl+c'], // emit form.cancel
  confirm: ['enter'], // confirm the focused field / activate a button / advance
  next: ['tab'], // focus the next field
  prev: ['shift+tab'], // focus the previous field
  scrollUp: ['pageup'], // scroll the body up a page (when it doesn't all fit)
  scrollDown: ['pagedown'] // scroll the body down a page
}

function mergeKeys(user) {
  const out = {}
  for (const k of Object.keys(defaultKeys)) {
    out[k] = user && user[k] ? [].concat(user[k]) : defaultKeys[k].slice()
  }
  return out
}
const SEP = '\u0000' // path/cache-key segment separator: a NUL, which never appears in a JSON key

const builders = { text, textarea, number, select, radio, confirm, multiselect, constant }

// Turn a leaf field definition object into a field instance; pass instances
// through untouched. Object/variant/conditional/array groups are handled by
// flatten(), not here.
function fromDef(def) {
  if (def instanceof Field) return def
  if (def && typeof def === 'object' && def.type) {
    const build = builders[def.type]
    if (!build) throw new Error('unknown field type: ' + def.type)
    return build(def)
  }
  throw new Error('form field must be a field instance or a { type, … } object')
}

// Fetch-or-create a field instance by cache key, so rebuilds preserve state.
function getOrCreate(ctx, keySegs, factory) {
  const k = keySegs.join(SEP)
  let f = ctx.cache.get(k)
  if (!f) {
    f = factory()
    ctx.cache.set(k, f)
  }
  return f
}

// Read `path` from `obj`. Returns { found, value } so an explicit `undefined`
// is distinguishable from "absent" (uses hasOwnProperty — pollution-safe; works
// on arrays since numeric string indices are own keys).
function getIn(obj, path) {
  let node = obj
  for (let i = 0; i < path.length; i++) {
    if (!node || typeof node !== 'object') return { found: false }
    const k = path[i]
    if (!Object.prototype.hasOwnProperty.call(node, k)) return { found: false }
    node = node[k]
  }
  return { found: true, value: node }
}

// Is `prefix` a (strict or equal) ancestor path of `path`?
function isAncestor(prefix, path) {
  if (prefix.length >= path.length) return false
  for (let i = 0; i < prefix.length; i++) if (prefix[i] !== path[i]) return false
  return true
}
function startsWith(path, prefix) {
  if (path.length < prefix.length) return false
  for (let i = 0; i < prefix.length; i++) if (path[i] !== prefix[i]) return false
  return true
}

// Flatten (possibly nested / dynamic / repeating) field defs into { fields,
// layout }. `parentPath` is the value path; `parentCache` is the parallel cache-
// key prefix (identical to parentPath except inside an array entry, where the
// position index in the path is an entry id in the cache — so values follow an
// entry across reorders). `active` is the inherited activeness predicate. `ctx`
// carries the instance cache, the array-state registry, and the set of array
// paths (for array-aware value()).
function flatten(defs, parentPath, parentCache, active, ctx) {
  const fields = []
  const layout = []
  const locals = {} // local name → field, for conditional guards

  const add = (field, activeWhen, indent) => {
    field._activeWhen = activeWhen
    fields.push(field)
    layout.push({ type: 'field', field, indent, activeWhen })
  }

  for (const def of defs) {
    // --- nested object: subform or optional gate -----------------------------
    if (def && !(def instanceof Field) && def.type === 'object') {
      const path = parentPath.concat(def.name)
      const cache = parentCache.concat(def.name)
      const indent = path.length - 1
      if (def.optional) {
        const toggle = getOrCreate(
          ctx,
          cache,
          () =>
            new SectionToggleField({
              name: def.name,
              title: def.title || def.name,
              description: def.description || '',
              value: !!def.value
            })
        )
        toggle.path = path
        locals[def.name] = toggle
        add(toggle, active, indent)
      } else {
        layout.push({
          type: 'header',
          title: def.title || def.name,
          description: def.description || '',
          indent,
          activeWhen: active
        })
      }
      const child = flatten(def.fields || [], path, cache, active, ctx)
      fields.push(...child.fields)
      layout.push(...child.layout)
      continue
    }

    // --- oneOf/anyOf variant -------------------------------------------------
    if (def && def.type === 'variant') {
      const path = parentPath.concat(def.name)
      const cache = parentCache.concat(def.name)
      const selector = getOrCreate(ctx, cache.concat('$select'), () =>
        select({
          name: def.name,
          label: def.selectorLabel || def.title || def.name,
          description: def.description || '',
          options: def.branches.map((b, i) => ({ label: b.title || `Option ${i + 1}`, value: i })),
          selected: 0
        })
      )
      selector.path = path
      selector.isSelector = true
      selector._branchKeys = def.branches.map((b) =>
        (b.fields || []).map((x) => x && x.name).filter(Boolean)
      )
      locals[def.name] = selector
      add(selector, active, path.length - 1)

      def.branches.forEach((branch, i) => {
        const branchActive = () => active() && selector.value() === i
        // Branches share the value path but are mutually exclusive, so give each
        // its own cache prefix — otherwise two branches' same-named fields would
        // collide on one cached instance.
        const child = flatten(branch.fields || [], path, cache.concat('~' + i), branchActive, ctx)
        fields.push(...child.fields)
        layout.push(...child.layout)
      })
      continue
    }

    // --- if/then/else conditional --------------------------------------------
    if (def && def.type === 'conditional') {
      const controllers = (def.when || []).map((w) => ({ name: w.name, allowed: w.allowed }))
      const guard = () =>
        controllers.every((c) => {
          const f = locals[c.name]
          return f ? c.allowed.has(f.value()) : false
        })
      const thenActive = () => active() && guard()
      const elseActive = () => active() && !guard()
      // Distinct cache prefixes so a then field and an else field of the same
      // name don't share one cached instance (they're mutually exclusive).
      const t = flatten(def.then || [], parentPath, parentCache.concat('~then'), thenActive, ctx)
      const e = flatten(def.else || [], parentPath, parentCache.concat('~else'), elseActive, ctx)
      fields.push(...t.fields, ...e.fields)
      layout.push(...t.layout, ...e.layout)
      continue
    }

    // --- array of objects ----------------------------------------------------
    if (def && def.type === 'array') {
      const path = parentPath.concat(def.name)
      const cache = parentCache.concat(def.name)
      const stateKey = path.join(SEP)
      ctx.arrayPaths.set(stateKey, path)
      let state = ctx.arrays.get(stateKey)
      if (!state) {
        state = { ids: [], nextId: 1, minItems: def.minItems || 0, maxItems: def.maxItems || 0 }
        for (let i = 0; i < state.minItems; i++) state.ids.push(state.nextId++)
        ctx.arrays.set(stateKey, state)
      }
      state.path = path
      state.cache = cache
      state.activeWhen = active
      const addable = def.addable !== false // uiSchema ui:options.addable
      const removable = def.removable !== false // uiSchema ui:options.removable

      layout.push({
        type: 'arrayHeader',
        title: def.title || def.name,
        description: def.description || '',
        indent: path.length - 1,
        arrayKey: stateKey,
        activeWhen: active
      })

      state.ids.forEach((id, pos) => {
        const entryPath = path.concat(String(pos))
        const entryCache = cache.concat('@' + id)
        layout.push({
          type: 'entryHeader',
          title: def.itemTitle || 'Item',
          index: pos,
          indent: path.length,
          activeWhen: active
        })
        const child = flatten(def.itemFields || [], entryPath, entryCache, active, ctx)
        fields.push(...child.fields)
        layout.push(...child.layout)
        if (removable && state.ids.length > state.minItems) {
          const btn = getOrCreate(ctx, entryCache.concat('$remove'), () =>
            action({
              name: '$remove',
              buttonLabel: '✕ Remove',
              action: { kind: 'array.remove', arrayKey: stateKey, id }
            })
          )
          btn.path = entryPath.concat('$remove')
          add(btn, active, path.length)
        }
      })

      if (addable && state.ids.length < state.maxItems) {
        const btn = getOrCreate(ctx, cache.concat('$add'), () =>
          action({
            name: '$add',
            buttonLabel: def.addLabel || '+ Add',
            action: { kind: 'array.add', arrayKey: stateKey }
          })
        )
        btn.path = path.concat('$add')
        add(btn, active, path.length - 1)
      }
      continue
    }

    // --- leaf ----------------------------------------------------------------
    const key = def instanceof Field ? def.key : def.name
    const field = getOrCreate(ctx, parentCache.concat(key), () => fromDef(def))
    field.path = parentPath.concat(field.key)
    if (field.key) locals[field.key] = field
    field._activeWhen = active
    fields.push(field)
    // A hidden field (uiSchema `ui:widget: 'hidden'`) is collected but never
    // rendered or focused.
    if (!field.hidden) {
      layout.push({ type: 'field', field, indent: field.path.length - 1, activeWhen: active })
    }
  }

  return { fields, layout }
}

class Form {
  constructor(opts = {}) {
    this.title = opts.title || ''
    this.description = opts.description || ''
    this.theme = theme.merge(opts.theme)
    this.keys = mergeKeys(opts.keys)
    // Re-run dirty async validators on submit (serially, behind one spinner).
    // Default on; pass false to opt out — then YOU are responsible for ensuring
    // async checks ran (the form will submit whatever's there).
    this.validateAsyncOnSubmit = opts.validateAsyncOnSubmit !== false
    this._formValidating = false // true while the submit-time async pass runs
    this._formSpinner = null
    this._queue = [] // async fields still to check this submit
    this._queueAt = 0
    this._submitToken = 0 // generation: discards stale/cancelled check results
    this._defs = opts.fields || []
    this._cache = new Map()
    this._arrays = new Map()
    this._arrayErrors = {}
    this.width = 0
    this.height = 0 // 0 = unknown → render everything inline (no scrolling)
    this._scroll = 0 // body scroll offset (lines), used once height is known
    this.ring = focus.create({
      items: [],
      keys: {
        next: key.binding({ keys: this.keys.next }),
        prev: key.binding({ keys: this.keys.prev })
      }
    })
    this.submitted = false
    this.cancelled = false
    this.busy = false // true while an async validation is in flight
    this._build()
    this._recompute()
    this._applyAutofocus()
  }

  // uiSchema `ui:autofocus`: start focus on the first field that asked for it.
  _applyAutofocus() {
    const i = this.ring.items.findIndex((f) => f.autofocus)
    if (i >= 0) this.ring.focus(i)
  }

  // (Re)expand defs into the current flat field list + render layout, reusing
  // cached instances so values survive structural changes (array add/remove).
  _build() {
    const ctx = { cache: this._cache, arrays: this._arrays, arrayPaths: new Map() }
    const { fields, layout } = flatten(this._defs, [], [], always, ctx)
    this.fields = fields
    this.layout = layout
    this._arrayPaths = ctx.arrayPaths
    this._arrayKeySet = new Set(ctx.arrayPaths.keys())
    this.fields.forEach((f) => f.setTheme(this.theme))
    return this
  }

  init() {
    const cmds = this.fields
      .map((f) => (typeof f.init === 'function' ? f.init() : null))
      .filter(Boolean)
    return cmds.length ? batch(...cmds) : null
  }

  _isActive(field) {
    return field._activeWhen ? !!field._activeWhen() : true
  }

  // Recompute the live fields and re-drive the focus ring with the active,
  // focusable subset — preserving focus on the current field when it survives.
  _recompute() {
    const focused = this.ring.focused()
    this.activeFields = this.fields.filter((f) => this._isActive(f))
    const items = this.activeFields.filter((f) => f.focusable !== false)
    this.ring.setItems(items)
    if (focused) {
      const i = items.indexOf(focused)
      if (i >= 0) this.ring.focus(i)
    }
    return this
  }

  // Build `value` at `path`, creating arrays at array paths and objects elsewhere.
  _setIn(obj, path, value) {
    let node = obj
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i]
      if (node[k] === null || node[k] === undefined || typeof node[k] !== 'object') {
        node[k] = this._arrayKeySet.has(path.slice(0, i + 1).join(SEP)) ? [] : {}
      }
      node = node[k]
    }
    node[path[path.length - 1]] = value
  }

  // The collected values, as a (possibly nested, possibly array-bearing) object.
  // Selectors, section gates, and buttons contribute no value; inactive fields
  // and the subtree of an unchecked optional section are omitted. Active arrays
  // always appear (as [] when empty).
  value() {
    const out = {}
    for (const f of this.activeFields) {
      if (f.isSection || f.isSelector || f.isButton) continue
      if (this._gatedOff(f)) continue
      this._setIn(out, f.path, f.value())
    }
    for (const state of this._arrays.values()) {
      if (state.activeWhen && !state.activeWhen()) continue
      if (!getIn(out, state.path).found) this._setIn(out, state.path, [])
    }
    return out
  }

  // Rehydrate from an existing object: size arrays to match the data (then
  // rebuild), point variant selectors at the matching branch, arm present
  // optional sections, and set every leaf by path.
  setValues(values) {
    if (!values || typeof values !== 'object') return this
    let resized = false
    for (const state of this._arrays.values()) {
      const res = getIn(values, state.path)
      if (!res.found || !Array.isArray(res.value)) continue
      const target = Math.max(Math.min(res.value.length, state.maxItems), state.minItems)
      if (state.ids.length === target) continue
      while (state.ids.length > target) this._evictEntry(state, state.ids.pop())
      while (state.ids.length < target) state.ids.push(state.nextId++)
      resized = true
    }
    if (resized) this._build()

    for (const f of this.fields) {
      if (f.isButton) continue
      const res = getIn(values, f.path)
      if (f.isSelector) {
        this._pickBranch(f, res)
        continue
      }
      if (f.isSection) {
        f.setValue(res.found && res.value !== null && res.value !== undefined)
        continue
      }
      if (!res.found || res.value === undefined) continue
      if (typeof f.setValue === 'function') f.setValue(res.value)
      f.error = null
    }
    return this._recompute()
  }

  _pickBranch(selector, res) {
    if (!res.found || !res.value || typeof res.value !== 'object') return
    const obj = res.value
    let best = -1
    let bestScore = 0
    selector._branchKeys.forEach((keys, i) => {
      const score = keys.reduce(
        (n, k) => n + (Object.prototype.hasOwnProperty.call(obj, k) ? 1 : 0),
        0
      )
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    })
    if (best >= 0) selector.setValue(best)
  }

  // Current errors, keyed by dotted path (live fields + array-level errors).
  errors() {
    const out = {}
    for (const f of this.activeFields) if (f.error) out[f.path.join('.')] = f.error
    for (const k of Object.keys(this._arrayErrors)) out[k] = this._arrayErrors[k]
    return out
  }

  _gatedOff(field) {
    for (const f of this.fields) {
      if (f.isSection && !f.checked && isAncestor(f.path, field.path)) return true
    }
    return false
  }

  _autoCheckSection() {
    const cur = this.ring.focused()
    if (!cur || cur.isSection || cur.isButton || cur.isEmpty(cur.value())) return
    for (const f of this.fields) {
      if (f.isSection && !f.checked && isAncestor(f.path, cur.path)) f.setValue(true)
    }
  }

  // Drop a removed entry's cached field instances so its values don't linger.
  _evictEntry(state, id) {
    const prefix = state.cache.concat('@' + id).join(SEP)
    for (const k of this._cache.keys()) {
      if (k === prefix || k.startsWith(prefix + SEP)) this._cache.delete(k)
    }
  }

  _k(name, msg) {
    return key.matches(msg, ...this.keys[name])
  }

  update(msg) {
    if (msg && msg.type === 'form.validated') return this._onValidated(msg)
    if (msg && msg.type === 'form.checkResult') return this._onCheckResult(msg)

    // The terminal size: switches on scrolling and keeps focus visible.
    if (msg && msg.type === 'resize') {
      this.width = msg.width
      this.height = msg.height
      this._scrollToFocused()
      return [this, null]
    }

    if (msg && msg.type === 'spinner.tick') {
      // The submit-time form spinner takes precedence over a field spinner;
      // they never run at once.
      if (this._formValidating && this._formSpinner) {
        const [, cmd] = this._formSpinner.update(msg)
        return [this, this._formValidating ? cmd : null]
      }
      const f = this._validatingField()
      if (f && f.spinner) {
        const [, cmd] = f.spinner.update(msg)
        return [this, f.validating ? cmd : null]
      }
      return [this, null]
    }

    if (msg && msg.type === 'key') {
      // Cancel works even mid-validation; everything else waits.
      if (this._k('cancel', msg)) {
        this._cancelValidation()
        this.cancelled = true
        return [this, emit({ type: 'form.cancel' })]
      }
      if (this.busy) return [this, null]

      // Deliberate submit (never plain enter — see defaultKeys).
      if (this._k('submit', msg)) return this.submit()

      // Manual scrolling when the body is taller than the screen.
      if (this._k('scrollUp', msg)) return this._scrollBy(-this._bodyHeight())
      if (this._k('scrollDown', msg)) return this._scrollBy(this._bodyHeight())

      const cur = this.ring.focused()
      // Enter confirms the focused field / activates a button / advances — it
      // does NOT submit. (A control that wants enter itself keeps it.)
      if (this._k('confirm', msg) && (!cur || !cur.wantsEnter())) {
        return this._confirm()
      }
    }

    if (this.busy) return [this, null]

    const [ring, cmd] = this.ring.update(msg)
    this.ring = ring
    if (msg && msg.type === 'key') {
      if (!this._k('next', msg) && !this._k('prev', msg)) this._autoCheckSection()
      this._recompute() // a selector/controller may have changed
      this._scrollToFocused() // keep the (possibly moved) focus in view
    }
    return [this, cmd]
  }

  _confirm() {
    const cur = this.ring.focused()
    if (!cur) return this._advance()
    if (cur.isButton) return this._activate(cur)
    if (cur.isSection || this._gatedOff(cur)) {
      cur.error = null
      return this._advance()
    }

    const v = cur.value()
    const reqErr = cur.requiredError(v)
    if (reqErr) {
      cur.error = reqErr
      return [this, null]
    }
    if (cur.isEmpty(v)) {
      cur.error = null
      return this._advance()
    }
    if (cur.isAsync()) {
      return this._beginAsync(cur, cur.runValidator(v))
    }
    cur.error = cur.syncValidate(v)
    if (cur.error) return [this, null]
    return this._advance()
  }

  // Run an array add/remove button, then rebuild and refocus sensibly.
  _activate(button) {
    const a = button.action
    if (!a) return [this, null]
    const state = this._arrays.get(a.arrayKey)
    if (!state) return [this, null]

    if (a.kind === 'array.add') {
      if (state.ids.length >= state.maxItems) return [this, null]
      state.ids.push(state.nextId++)
      this._build()
      this._recompute()
      this._focusPrefix(state.path.concat(String(state.ids.length - 1)))
    } else if (a.kind === 'array.remove') {
      const idx = state.ids.indexOf(a.id)
      if (idx >= 0) {
        this._evictEntry(state, a.id)
        state.ids.splice(idx, 1)
      }
      this._build()
      this._recompute()
      this._focusAddOrPrefix(state)
    }
    this._scrollToFocused()
    return [this, null]
  }

  _focusPrefix(prefix) {
    const i = this.ring.items.findIndex((f) => startsWith(f.path, prefix))
    if (i >= 0) this.ring.focus(i)
  }

  _focusAddOrPrefix(state) {
    const add = this.ring.items.findIndex(
      (f) =>
        f.isButton &&
        f.action &&
        f.action.kind === 'array.add' &&
        f.action.arrayKey === state.path.join(SEP)
    )
    if (add >= 0) this.ring.focus(add)
    else this._focusPrefix(state.path)
  }

  _beginAsync(field, promise) {
    field.error = null
    field.validating = true
    this.busy = true
    const id = ++field._runId
    const fieldKey = field.key

    const tickCmd = field.startSpinner()
    const checkCmd = () =>
      Promise.resolve()
        .then(() => promise)
        .then((err) => ({ type: 'form.validated', id, key: fieldKey, error: err || null }))
        .catch((e) => ({
          type: 'form.validated',
          id,
          key: fieldKey,
          error: (e && e.message) || 'check failed'
        }))

    return [this, batch(tickCmd, checkCmd)]
  }

  _onValidated(msg) {
    const field = this.fields.find((f) => f.key === msg.key)
    if (!field || !field.validating || msg.id !== field._runId) return [this, null]

    field.validating = false
    field.stopSpinner()
    field.error = msg.error || null
    this.busy = false

    if (field.error) return [this, null]
    field._asyncCheckedValue = field.value() // remember it passed; submit won't redo it
    return this._advance()
  }

  _cancelValidation() {
    const field = this._validatingField()
    if (field) {
      field._runId++
      field.validating = false
      field.stopSpinner()
    }
    if (this._formValidating) {
      this._submitToken++ // strand any in-flight submit check
      this._endFormValidation()
    }
    this.busy = false
  }

  _validatingField() {
    return this.fields.find((f) => f.validating) || null
  }

  // Move focus to the next field (never submits — submit is its own key). Stays
  // put on the last field; the user reaches buttons with `next`/tab and commits
  // with the `submit` key.
  _advance() {
    const next = this.ring.index + 1
    if (next < this.ring.items.length) this.ring.focus(next)
    this._scrollToFocused()
    return [this, null]
  }

  // Validate every live, focusable, non-button field plus array min-item counts;
  // jump to the first error, else complete and emit form.submit with the values.
  submit() {
    this._arrayErrors = {}
    let firstErr = null
    for (const f of this.activeFields) {
      if (f.isSection || f.isSelector || f.isButton || f.focusable === false || this._gatedOff(f)) {
        f.error = null
        continue
      }
      const e = f.syncValidate(f.value())
      f.error = e
      if (e && !firstErr) firstErr = f
    }
    if (firstErr) {
      const i = this.ring.items.indexOf(firstErr)
      if (i >= 0) this.ring.focus(i)
      this._scrollToFocused()
      return [this, null]
    }
    // Array minItems: only for live arrays.
    for (const state of this._arrays.values()) {
      if (state.activeWhen && !state.activeWhen()) continue
      if (state.ids.length < state.minItems) {
        const n = state.minItems
        this._arrayErrors[state.path.join('.')] = `add at least ${n} item${n === 1 ? '' : 's'}`
      }
    }
    if (Object.keys(this._arrayErrors).length) return [this, null]

    // Async pass: re-run any dirty async validators that never ran (or whose
    // value changed since). Serial, behind one form spinner — unless opted out.
    if (this.validateAsyncOnSubmit) {
      const queue = this.activeFields.filter(
        (f) =>
          !f.isSection &&
          !f.isSelector &&
          !f.isButton &&
          f.focusable !== false &&
          !this._gatedOff(f) &&
          f.needsAsyncCheck()
      )
      if (queue.length) return this._beginFormValidation(queue)
    }

    this.submitted = true
    return [this, emit({ type: 'form.submit', values: this.value() })]
  }

  // Build the form-level validating spinner from the theme (mirrors a field's).
  _makeSpinner() {
    const cfg = (this.theme && this.theme.spinner) || {}
    const frames = typeof cfg.frames === 'string' ? FRAME_SETS[cfg.frames] : cfg.frames
    return spinner.create({ frames, fps: cfg.fps })
  }

  // Enter the submit-time async pass: gate input, show the form spinner, and
  // kick off the first check. Each check resolves to a 'form.checkResult' Msg.
  _beginFormValidation(queue) {
    this._formValidating = true
    this.busy = true
    this._queue = queue
    this._queueAt = 0
    this._submitToken++
    this._formSpinner = this._makeSpinner()
    return [this, batch(this._formSpinner.init(), this._checkCmd(0))]
  }

  // A Cmd that runs queue[i]'s async validator and reports the verdict. The
  // generation token is captured at issue time so a cancel makes it stale.
  _checkCmd(i) {
    const field = this._queue[i]
    const token = this._submitToken
    const value = field.value()
    const result = field.runValidator(value)
    return () =>
      Promise.resolve()
        .then(() => result)
        .then((err) => ({ type: 'form.checkResult', token, index: i, value, error: err || null }))
        .catch((e) => ({
          type: 'form.checkResult',
          token,
          index: i,
          value,
          error: (e && e.message) || 'check failed'
        }))
  }

  _onCheckResult(msg) {
    // Drop results from a cancelled or superseded submit.
    if (!this._formValidating || msg.token !== this._submitToken) return [this, null]
    const field = this._queue[msg.index]

    if (msg.error) {
      field.error = msg.error
      this._endFormValidation()
      const ri = this.ring.items.indexOf(field)
      if (ri >= 0) this.ring.focus(ri)
      this._scrollToFocused()
      return [this, null]
    }

    field._asyncCheckedValue = msg.value // passed for this value
    field.error = null
    const next = msg.index + 1
    if (next < this._queue.length) {
      this._queueAt = next
      return [this, this._checkCmd(next)] // spinner keeps ticking on its own
    }

    // All clear → submit.
    this._endFormValidation()
    this.submitted = true
    return [this, emit({ type: 'form.submit', values: this.value() })]
  }

  _endFormValidation() {
    this._formValidating = false
    this.busy = false
    this._formSpinner = null
    this._queue = []
    this._queueAt = 0
  }

  // The fixed top block (title + description), as lines.
  _renderHead() {
    const t = this.theme
    const lines = []
    if (this.title) lines.push(t.title(this.title), '')
    if (this.description) lines.push(t.description(this.description), '')
    return lines
  }

  // The scrollable body: every active layout item rendered to lines, plus a Map
  // from each field to its [startLine, endLine] range (for follow-the-focus).
  _renderBody() {
    const t = this.theme
    const lines = []
    const range = new Map()
    for (const item of this.layout) {
      if (item.activeWhen && !item.activeWhen()) continue
      const pad = '  '.repeat(item.indent || 0)
      if (item.type === 'header') {
        lines.push(pad + t.sectionTitle(item.title))
        if (item.description) lines.push(pad + t.description(item.description))
        continue
      }
      if (item.type === 'arrayHeader') {
        lines.push(pad + t.sectionTitle(item.title))
        if (item.description) lines.push(pad + t.description(item.description))
        const err = this._arrayErrors[item.arrayKey.split(SEP).join('.')]
        if (err) lines.push(pad + t.error(t.errorPrefix + err))
        continue
      }
      if (item.type === 'entryHeader') {
        lines.push(pad + t.help(`— ${item.title} ${item.index + 1} —`))
        continue
      }
      const f = item.field
      const start = lines.length
      for (const ln of f.view().split('\n')) lines.push(pad + ln)
      const menu = typeof f.menuView === 'function' ? f.menuView() : ''
      if (menu) for (const ln of menu.split('\n')) lines.push(pad + ln)
      range.set(f, [start, lines.length - 1])
      lines.push('')
    }
    return { lines, range }
  }

  _renderFooter(scrollable) {
    const t = this.theme
    if (this._formValidating) {
      const frame = this._formSpinner ? this._formSpinner.view() : ''
      const n = this._queue.length
      const k = Math.min(this._queueAt + 1, n)
      return [t.validating(`  ${frame ? frame + ' ' : ''}validating… ${k}/${n}`)]
    }
    if (this.submitted) return [t.help('  ✓ submitted')]
    const chord = (a) => (a && a[0]) || ''
    const parts = [
      `${chord(this.keys.next)} move`,
      `${chord(this.keys.confirm)} confirm`,
      `${chord(this.keys.submit)} submit`,
      `${chord(this.keys.cancel)} cancel`
    ]
    if (scrollable) parts.push('↕ scroll')
    return [t.help('  ' + parts.join(' · '))]
  }

  // Extra rows a theme.frame() adds (border + vertical padding), measured by
  // framing a one-line probe. 0 when there's no frame.
  _frameRows() {
    const frame = this.theme && this.theme.frame
    if (typeof frame !== 'function') return 0
    return Math.max(0, frame('x', { width: this.width }).split('\n').length - 1)
  }

  // Visible body height, or 0 when the size is unknown (render inline, no scroll).
  // Reserves rows for the head, the footer, and any frame chrome.
  _bodyHeight() {
    if (!this.height) return 0
    return Math.max(1, this.height - this._renderHead().length - 1 - this._frameRows())
  }

  // Scroll so the focused field's line range is visible, given the body height.
  _scrollToFocused() {
    const avail = this._bodyHeight()
    if (!avail) return
    const { lines, range } = this._renderBody()
    const max = Math.max(0, lines.length - avail)
    const cur = this.ring.focused()
    const r = cur && range.get(cur)
    if (r) {
      if (r[0] < this._scroll) this._scroll = r[0]
      else if (r[1] > this._scroll + avail - 1) this._scroll = r[1] - avail + 1
    }
    this._scroll = Math.min(Math.max(0, this._scroll), max)
  }

  _scrollBy(n) {
    const avail = this._bodyHeight()
    if (avail) {
      const { lines } = this._renderBody()
      const max = Math.max(0, lines.length - avail)
      this._scroll = Math.min(Math.max(0, this._scroll + n), max)
    }
    return [this, null]
  }

  // Wrap the composed view in the theme's frame (border/background/padding), if
  // any. Kept separate so the scroll math (which reserves the frame's rows) and
  // the final paint agree.
  _frame(inner) {
    const frame = this.theme && this.theme.frame
    return typeof frame === 'function'
      ? frame(inner, { width: this.width, title: this.title })
      : inner
  }

  view() {
    const head = this._renderHead()
    const { lines: body } = this._renderBody()
    const avail = this._bodyHeight()

    // Unknown size, or it all fits: render inline (footer not scrollable).
    if (!avail || body.length <= avail) {
      const footer = this._renderFooter(false)
      return this._frame(head.concat(body, footer).join('\n'))
    }

    // Scroll: a fixed-height window of the body keeps the layout stable.
    const max = Math.max(0, body.length - avail)
    const start = Math.min(Math.max(0, this._scroll), max)
    const window = body.slice(start, start + avail)
    return this._frame(head.concat(window, this._renderFooter(true)).join('\n'))
  }
}

function create(opts) {
  return new Form(opts)
}

async function run(form, opts = {}) {
  let result = null
  class Runner {
    init() {
      return form.init()
    }
    update(msg) {
      if (msg && msg.type === 'form.submit') {
        result = msg.values
        return [this, quit]
      }
      if (msg && msg.type === 'form.cancel') {
        result = null
        return [this, quit]
      }
      const [f, cmd] = form.update(msg)
      form = f
      return [this, cmd]
    }
    view() {
      return form.view()
    }
  }
  await new Program(new Runner(), opts).run()
  return result
}

module.exports = { create, run, Form, fromDef }
