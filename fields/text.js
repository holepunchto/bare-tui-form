// text — a single-line text field, wrapping bare-tui's textinput.
const { textinput } = require('bare-tui')
const { Field } = require('./base')

class TextField extends Field {
  constructor(opts = {}) {
    super(opts)
    this.control = textinput.create({
      value: opts.value || '',
      placeholder: opts.placeholder || '',
      prompt: opts.prompt ?? '> ',
      charLimit: opts.charLimit || 0,
      echoMode: opts.echoMode || 'normal'
    })
  }

  value() {
    return this.control.value
  }

  setValue(v) {
    this.control.setValue(v === null || v === undefined ? '' : v)
    return this
  }

  controlView() {
    return this.control.view()
  }
}

function text(opts) {
  return new TextField(opts)
}

module.exports = { text, TextField }
