// textarea — a multi-line text field, wrapping bare-tui's textarea.
//
// Unlike the other fields it *captures enter* (newline), so the form moves on
// via tab rather than enter.
const { textarea } = require('bare-tui')
const { Field } = require('./base')

class TextareaField extends Field {
  constructor(opts = {}) {
    super(opts)
    this.control = textarea.create({
      value: opts.value || '',
      placeholder: opts.placeholder || '',
      width: opts.width || 40,
      height: opts.rows || opts.height || 4, // `rows` mirrors uiSchema's ui:rows
      charLimit: opts.charLimit || 0
    })
  }

  value() {
    return this.control.value
  }

  setValue(v) {
    this.control.setValue(v === null || v === undefined ? '' : v)
    return this
  }

  // Enter inserts a newline here; advance with tab instead.
  wantsEnter() {
    return true
  }

  controlView() {
    return this.control.view()
  }
}

function textarea_(opts) {
  return new TextareaField(opts)
}

module.exports = { textarea: textarea_, TextareaField }
