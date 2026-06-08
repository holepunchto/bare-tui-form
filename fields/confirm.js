// confirm — a boolean field, wrapping bare-tui's checkbox.
//
// When `required`, "empty" means "not checked", so a required confirm must be
// ticked to pass (e.g. an "I agree" box).
const { checkbox } = require('bare-tui')
const { Field } = require('./base')

class ConfirmField extends Field {
  constructor(opts = {}) {
    super(opts)
    // The checkbox line *is* the label, so suppress the separate label row that
    // every other field renders above its control — otherwise the text shows
    // twice ("Accept terms" then "[ ] Accept terms").
    this.hideLabel = true
    // The checkbox draws just the pointer + box; the label is added (themed) in
    // controlView so it picks up labelFocused and the required marker.
    this.control = checkbox.create({ label: '', checked: !!opts.value })
  }

  value() {
    return this.control.checked
  }

  setValue(v) {
    this.control.setChecked(v)
    return this
  }

  isEmpty(v) {
    return v !== true
  }

  // "› [x] Accept terms *" — the box from the checkbox, the label themed here.
  controlView() {
    const t = this.theme
    const text = this.label + (this.required ? t.requiredMarker : '')
    const styled = this.focused ? t.labelFocused(text) : t.label(text)
    return this.control.view() + ' ' + styled
  }
}

function confirm(opts) {
  return new ConfirmField(opts)
}

module.exports = { confirm, ConfirmField }
