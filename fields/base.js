// Field — the base class every form field extends.
//
// A field adapts a bare-tui control (textinput, select, radio, …) to the form:
// it carries a value `key`, a `label`/`description`, an optional `validate`
// function, and the current `error`. The form treats every field through one
// small contract:
//
//   field.key                  // the value key in form.value()
//   field.focus() / blur()     // gate input (delegates to the control)
//   field.focused              // is this field focused
//   field.update(msg) → [f,cmd]// fold a Msg (delegates to the control)
//   field.value()              // current value           (subclass)
//   field.setValue(v)          // set it                  (subclass)
//   field.controlView()        // render just the control (subclass)
//   field.menuView()           // optional overlay (select dropdown); '' default
//   field.wantsEnter()         // true if enter belongs to the control right now
//   field.validate()           // run SYNC validation, set .error, return it
//   field.view()               // label + description + control + error/spinner
//
// Validation can be synchronous or asynchronous. If `validate` is an async
// function it's run by the form through a Cmd, with a spinner shown meanwhile;
// the sync helpers below (requiredError/syncValidate) are what the form uses for
// the instant checks, and runValidator() is what it awaits for the async one.
//
// Subclasses set `this.control` (a bare-tui component) and implement value(),
// setValue() and controlView(). The base delegates focus/blur/update to the
// control and assembles the field's block in view(), styled through `this.theme`
// (set to the form's theme on construction, or the default for a lone field).
const { spinner } = require('bare-tui')
const { defaultTheme } = require('../theme')

const FRAME_SETS = { dots: spinner.dots, line: spinner.line, points: spinner.points }

// Sentinel for "this field's async validator has never passed for any value".
const UNCHECKED = Symbol('unchecked')

class Field {
  constructor(opts = {}) {
    this.key = opts.name || opts.key || ''
    // The address of this field's value in the (possibly nested) result object.
    // A flat field's path is just [key]; a field inside a nested object section
    // carries the full chain (['address', 'street']). The form walks it to build
    // and read nested values. Set by the form when it flattens nested defs.
    this.path = Array.isArray(opts.path) && opts.path.length ? opts.path.slice() : [this.key]
    // Section toggles (the optional-subform checkbox) set this; leaf fields don't.
    this.isSection = false
    // A oneOf/anyOf variant *selector* sets this: it drives which branch is live
    // but carries no value of its own, so the form skips it when collecting.
    this.isSelector = false
    // Can the focus ring land here? A const (fixed discriminator) field is shown
    // and collected but not interactive, so it opts out.
    this.focusable = true
    // An action button (array add/remove): focusable, carries no value, and the
    // form runs its `action` on enter instead of validating/advancing.
    this.isButton = false
    this.label = opts.label || this.key
    this.description = opts.description || ''
    // Presentation (uiSchema): extra help line, hidden label, read-only display,
    // initial-focus hint, and fully-hidden (collected but never shown) fields.
    this.help = opts.help || ''
    this.hideLabel = !!opts.hideLabel
    this.autofocus = !!opts.autofocus
    this.hidden = !!opts.hidden
    this.inverse = !!opts.inverse
    if (this.inverse) this.label = `no ${this.label}`
    if (opts.readonly || opts.hidden) this.focusable = false
    this.required = !!opts.required
    this.requiredMessage = opts.requiredMessage || 'required'
    this.validatingMessage = opts.validatingMessage || 'checking…'
    this._validate = typeof opts.validate === 'function' ? opts.validate : null
    this._isAsync = !!this._validate && this._validate.constructor.name === 'AsyncFunction'

    this.error = null
    this.validating = false // true while an async check is in flight
    this.spinner = null // bare-tui spinner, live only while validating
    this._runId = 0 // generation: bumped to discard stale async results
    // The value its async validator last *passed* for; compared to the current
    // value to tell whether an async check still needs running (see the form's
    // validate-on-submit pass). UNCHECKED until the first passing result.
    this._asyncCheckedValue = UNCHECKED

    this.theme = defaultTheme
    this.control = null // set by the subclass
  }

  setTheme(theme) {
    this.theme = theme
    return this
  }

  focus() {
    if (this.control) this.control.focus()
    return this
  }

  blur() {
    if (this.control) this.control.blur()
    return this
  }

  get focused() {
    return this.control ? this.control.focused : false
  }

  update(msg) {
    if (!this.control) return [this, null]
    const [c, cmd] = this.control.update(msg)
    this.control = c
    // Editing clears a stale error; it's re-checked on the next confirm.
    if (this.error) this.error = null
    return [this, cmd]
  }

  // Most controls don't need enter; textarea (newline) and an open select
  // (commit) do, and override this.
  wantsEnter() {
    return false
  }

  // Overlay content (the select dropdown). Empty for everything else.
  menuView() {
    return ''
  }

  // Is `v` "empty" for the purpose of `required`? Overridable (confirm/number).
  isEmpty(v) {
    return v === '' || v === null || v === undefined || (Array.isArray(v) && v.length === 0)
  }

  // --- validation -----------------------------------------------------------

  // The required-but-empty error, or null. (sync)
  requiredError(v) {
    return this.required && this.isEmpty(v) ? this.requiredMessage : null
  }

  hasValidator() {
    return !!this._validate
  }

  isAsync() {
    return this._isAsync
  }

  // Does this field have an async validator whose current (non-empty) value
  // hasn't passed yet? Used by the form to re-run dirty async checks on submit.
  // Editing changes the value, so a once-passed field goes dirty automatically.
  needsAsyncCheck() {
    if (!this._isAsync) return false
    const v = this.value()
    if (this.isEmpty(v)) return false
    return this._asyncCheckedValue !== v
  }

  // Run the user validator (may return a string, null, or a Promise of those).
  runValidator(v) {
    return this._validate ? this._validate(v) : null
  }

  // The instant verdict: required, then the sync validator. Async validators
  // aren't run here (the form awaits them separately); an empty optional field
  // is always fine.
  syncValidate(v) {
    if (this.required && this.isEmpty(v)) return this.requiredMessage
    if (this.isEmpty(v)) return null
    if (this._validate && !this._isAsync) return this._validate(v) || null
    return null
  }

  // Backwards-compatible sync entry point: set and return .error.
  validate() {
    this.error = this.syncValidate(this.value())
    return this.error
  }

  // --- spinner lifecycle (driven by the form) -------------------------------

  // Start the validating spinner and return its initial tick Cmd.
  startSpinner() {
    const cfg = (this.theme && this.theme.spinner) || {}
    const frames = typeof cfg.frames === 'string' ? FRAME_SETS[cfg.frames] : cfg.frames
    this.spinner = spinner.create({ frames, fps: cfg.fps })
    return this.spinner.init()
  }

  stopSpinner() {
    this.spinner = null
  }

  // --- rendering ------------------------------------------------------------

  // label (+ marker when required) · description · control · help · error|spinner.
  // The label is omitted when hideLabel (uiSchema's `ui:label: false`).
  view() {
    const t = this.theme
    const lines = []
    if (!this.hideLabel) {
      const labelText = this.label + (this.required ? t.requiredMarker : '')
      lines.push(this.focused ? t.labelFocused(labelText) : t.label(labelText))
    }
    if (this.description) lines.push(t.description(this.description))
    lines.push(...this.controlView().split('\n'))
    if (this.help) lines.push(t.help(this.help))

    if (this.validating) {
      const frame = this.spinner ? this.spinner.view() : ''
      lines.push(t.validating((frame ? frame + ' ' : '') + this.validatingMessage))
    } else if (this.error) {
      lines.push(t.error(t.errorPrefix + this.error))
    }
    return lines.join('\n')
  }
}

module.exports = { Field }
