// select — pick one from a dropdown, wrapping bare-tui's select.
//
// It forwards the control's overlay (menuView) so the form can composite the
// dropdown, and claims enter while the menu is open (to commit the choice).
const { select } = require('bare-tui')
const { Field } = require('./base')

class SelectField extends Field {
  constructor(opts = {}) {
    super(opts)
    this.control = select.create({
      options: opts.options || [],
      selected: opts.selected ?? -1,
      placeholder: opts.placeholder || 'select…',
      maxVisible: opts.maxVisible || 6
    })
  }

  value() {
    return this.control.value()
  }

  setValue(v) {
    this.control.setValue(v)
    return this
  }

  // While the menu is open, enter commits the highlighted option.
  wantsEnter() {
    return this.control.open
  }

  menuView() {
    return this.control.menuView()
  }

  controlView() {
    const view = this.control.view()
    if (this.control.open) return view
    return view + '\n' + this.theme.help('  space to open')
  }
}

function select_(opts) {
  return new SelectField(opts)
}

module.exports = { select: select_, SelectField }
