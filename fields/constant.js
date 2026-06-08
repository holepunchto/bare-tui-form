// constant — a fixed value (JSON Schema `const`).
//
// A const property carries a value the user can't change — most often the
// discriminator of a oneOf branch (`type: { const: 'card' }`). It's shown as a
// static line and included in the collected value, but it's not interactive, so
// it opts out of the focus ring (`focusable = false`) and never errors.
const { Field } = require('./base')

class ConstField extends Field {
  constructor(opts = {}) {
    super(opts)
    this.focusable = false
    this.constValue = opts.value
  }

  value() {
    return this.constValue
  }

  setValue() {
    return this // fixed — rehydration can't change a const
  }

  isEmpty() {
    return false
  }

  syncValidate() {
    return null
  }

  controlView() {
    return this.constValue === undefined ? '' : String(this.constValue)
  }
}

function constant(opts) {
  return new ConstField(opts)
}

module.exports = { constant, ConstField }
