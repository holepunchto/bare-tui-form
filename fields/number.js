// number — a numeric field. Wraps textinput for entry, but value() coerces to a
// Number and syncValidate() enforces numeric-ness plus optional min/max/integer.
const { textinput } = require('bare-tui')
const { Field } = require('./base')

class NumberField extends Field {
  constructor(opts = {}) {
    super(opts)
    this.min = opts.min
    this.max = opts.max
    this.integer = !!opts.integer
    this.control = textinput.create({
      value: opts.value === undefined || opts.value === null ? '' : String(opts.value),
      placeholder: opts.placeholder || '',
      prompt: opts.prompt ?? '> '
    })
  }

  // null when blank, a finite Number when parseable, otherwise NaN (so
  // syncValidate() can flag it; an unflagged NaN would JSON-serialize to null).
  value() {
    const raw = this.control.value.trim()
    if (raw === '') return null
    return Number(raw)
  }

  setValue(v) {
    this.control.setValue(v === undefined || v === null ? '' : String(v))
    return this
  }

  isEmpty(v) {
    return v === null
  }

  // The numeric rules live here (not in validate()) because the form validates
  // through syncValidate — both on enter-confirm and on submit.
  syncValidate(v) {
    // Base handles required + empty + any custom validator first.
    const base = super.syncValidate(v)
    if (base) return base

    if (v === null) return null // optional and blank
    if (Number.isNaN(v)) return 'must be a number'
    if (this.integer && !Number.isInteger(v)) return 'must be a whole number'
    if (this.min !== undefined && v < this.min) return `must be ≥ ${this.min}`
    if (this.max !== undefined && v > this.max) return `must be ≤ ${this.max}`
    return null
  }

  controlView() {
    return this.control.view()
  }
}

function number(opts) {
  return new NumberField(opts)
}

module.exports = { number, NumberField }
