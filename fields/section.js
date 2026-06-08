// section — the include/omit toggle for an optional nested-object section.
//
// A non-required object in a schema becomes a sub-section the user can choose to
// fill in or leave out. This field is its gate: a focusable checkbox rendered as
// the section's heading. The form:
//
//   - auto-checks it the moment any field inside the section gets a value,
//   - omits the whole subtree from value() while it's unchecked,
//   - and only validates the section's inner `required` fields while it's on.
//
// So the user is in control — start typing and the section is "in", toggle the
// box off to drop it — and the fields stay visible the whole time (no dynamic
// show/hide). It never carries a value of its own; `isSection` tells the form to
// treat it as a gate, not a leaf, and it never blocks submission itself.
const { checkbox } = require('bare-tui')
const { Field } = require('./base')

class SectionToggleField extends Field {
  constructor(opts = {}) {
    super(opts)
    this.isSection = true
    this.control = checkbox.create({
      label: opts.title || opts.label || this.key,
      checked: !!opts.value
    })
  }

  get checked() {
    return this.control.checked
  }

  value() {
    return this.control.checked
  }

  setValue(v) {
    this.control.setChecked(v)
    return this
  }

  // A section gate is never itself required and never reports an error — the
  // completeness of an included section is enforced by its own inner fields.
  requiredError() {
    return null
  }

  syncValidate() {
    return null
  }

  controlView() {
    return this.control.view()
  }

  // Renders as the section heading: the checkbox + title, with a quiet hint when
  // it's off so it's clear the section won't be submitted.
  view() {
    const t = this.theme
    const head = t.sectionTitle(this.control.view())
    const hint = this.control.checked ? '' : '  ' + t.help('(off — not included)')
    const lines = [head + hint]
    if (this.description) lines.push(t.description(this.description))
    return lines.join('\n')
  }
}

function section(opts) {
  return new SectionToggleField(opts)
}

module.exports = { section, SectionToggleField }
