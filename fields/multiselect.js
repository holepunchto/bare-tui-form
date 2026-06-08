// multiselect — choose many from a list of toggles.
//
// bare-tui has no checkbox *group*, so this field implements its own little
// control inline (cursor + a checked set) rather than wrapping one. It still
// presents the standard Field contract, so the form treats it like any other.
// value() is an array of the checked values, in option order.
const { key } = require('bare-tui')
const { Field } = require('./base')

const keys = {
  up: key.binding({ keys: ['up', 'k'] }),
  down: key.binding({ keys: ['down', 'j'] }),
  toggle: key.binding({ keys: ['space'] })
}

function normalize(opt) {
  if (opt !== null && typeof opt === 'object') {
    const value = 'value' in opt ? opt.value : opt.label
    return { label: String(opt.label ?? opt.value ?? ''), value }
  }
  return { label: String(opt), value: opt }
}

class MultiSelectField extends Field {
  constructor(opts = {}) {
    super(opts)
    this.options = (opts.options || []).map(normalize)
    this.cursor = 0
    this.checked = new Set() // indices
    this._focused = false
    this.onGlyph = opts.onGlyph || '[x]'
    this.offGlyph = opts.offGlyph || '[ ]'
    if (Array.isArray(opts.value)) this.setValue(opts.value)
    // No wrapped control; we override the delegating methods below.
    this.control = null
  }

  focus() {
    this._focused = true
    return this
  }

  blur() {
    this._focused = false
    return this
  }

  get focused() {
    return this._focused
  }

  value() {
    const out = []
    this.options.forEach((o, i) => {
      if (this.checked.has(i)) out.push(o.value)
    })
    return out
  }

  setValue(values) {
    const want = new Set(values || [])
    this.checked = new Set()
    this.options.forEach((o, i) => {
      if (want.has(o.value)) this.checked.add(i)
    })
    return this
  }

  update(msg) {
    if (!this._focused || !msg || msg.type !== 'key') return [this, null]
    if (key.matches(msg, keys.up)) this.cursor = Math.max(0, this.cursor - 1)
    else if (key.matches(msg, keys.down)) {
      this.cursor = Math.min(this.options.length - 1, this.cursor + 1)
    } else if (key.matches(msg, keys.toggle)) {
      if (this.checked.has(this.cursor)) this.checked.delete(this.cursor)
      else this.checked.add(this.cursor)
      if (this.error) this.error = null
    }
    return [this, null]
  }

  controlView() {
    return this.options
      .map((o, i) => {
        const pointer = this._focused && i === this.cursor ? '› ' : '  '
        const box = this.checked.has(i) ? this.onGlyph : this.offGlyph
        return pointer + box + ' ' + o.label
      })
      .join('\n')
  }
}

function multiselect(opts) {
  return new MultiSelectField(opts)
}

module.exports = { multiselect, MultiSelectField, keys }
