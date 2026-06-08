// radio — pick one from an expanded list, wrapping bare-tui's radio.
const { radio } = require('bare-tui')
const { Field } = require('./base')

class RadioField extends Field {
  constructor(opts = {}) {
    super(opts)
    this.control = radio.create({
      options: opts.options || [],
      selected: opts.selected || 0
    })
  }

  value() {
    return this.control.value()
  }

  setValue(v) {
    this.control.setValue(v)
    return this
  }

  controlView() {
    return this.control.view()
  }
}

function radio_(opts) {
  return new RadioField(opts)
}

module.exports = { radio: radio_, RadioField }
