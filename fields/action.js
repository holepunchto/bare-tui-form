// action — a focusable button (used for array add / remove).
//
// It carries no value; instead it holds an `action` descriptor that the form
// runs when the button is confirmed (enter). The form recognizes `isButton` and
// routes enter to its own _activate() rather than validating/advancing, so a
// button never blocks or submits. Reached by tab like any focusable field.
const { Field } = require('./base')

class ActionField extends Field {
  constructor(opts = {}) {
    super(opts)
    this.isButton = true
    this.action = opts.action || null
    this.buttonLabel = opts.buttonLabel || opts.label || 'OK'
    this._focused = false
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
    return undefined
  }

  setValue() {
    return this
  }

  isEmpty() {
    return true
  }

  syncValidate() {
    return null
  }

  update() {
    return [this, null] // the form handles enter via _activate
  }

  view() {
    const t = this.theme
    const text = (this._focused ? '› ' : '  ') + this.buttonLabel
    return this._focused ? t.labelFocused(text) : t.help(text)
  }
}

function action(opts) {
  return new ActionField(opts)
}

module.exports = { action, ActionField }
