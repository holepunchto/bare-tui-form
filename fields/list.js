// list — an editable list of scalar text values (add / remove rows).
//
// For a repeatable value with no fixed option set — tags, waypoints, a flag the
// CLI accepts many times — where multiselect (a fixed enum) and array (a
// repeatable OBJECT subform) don't fit. Each row is a bare-tui textinput; the
// field is one focus stop in the form and manages its own row cursor:
//
//   ↑/↓   move between rows
//   ↵     add a new row below and focus it
//   ⌫     on an EMPTY row, remove it (otherwise deletes a character)
//   tab   leave the field (the form's focus ring)
//
// value() is a plain array of the non-empty rows, in order — so a multi-valued
// CLI flag round-trips as ["a","b"], not a single space-joined string.
const { key, textinput } = require('bare-tui')
const { Field } = require('./base')

const keys = {
  up: key.binding({ keys: ['up'] }),
  down: key.binding({ keys: ['down'] }),
  add: key.binding({ keys: ['enter'] }),
  back: key.binding({ keys: ['backspace'] })
}

class ListField extends Field {
  constructor(opts = {}) {
    super(opts)
    this.itemPlaceholder = opts.itemPlaceholder || 'type a value…'
    this.min = Math.max(0, opts.minItems || 0)
    this.max = opts.maxItems > 0 ? opts.maxItems : 0 // 0 = unbounded
    this.cursor = 0
    this._focused = false
    const seed = Array.isArray(opts.value) ? opts.value.map(String) : []
    // Always keep at least one (editable) row, even when minItems is 0; empty
    // rows are dropped from value().
    this.rows = (seed.length ? seed : ['']).map((v) => this._mkRow(v))
    // No single wrapped control — the delegating methods are overridden below.
    this.control = null
  }

  _mkRow(value) {
    return textinput.create({ value, placeholder: this.itemPlaceholder, prompt: '' })
  }

  _floor() {
    return Math.max(this.min, 1) // never collapse below one editable row
  }

  focus() {
    this._focused = true
    this._syncFocus()
    return this
  }

  blur() {
    this._focused = false
    for (const r of this.rows) r.blur()
    return this
  }

  get focused() {
    return this._focused
  }

  // Enter belongs to the field (it adds a row) whenever it's focused, so the form
  // doesn't treat enter as confirm/advance. Tab still moves to the next field.
  wantsEnter() {
    return this._focused
  }

  value() {
    return this.rows.map((r) => r.value).filter((v) => v.trim() !== '')
  }

  setValue(values) {
    const seed = Array.isArray(values) ? values.map(String) : []
    this.rows = (seed.length ? seed : ['']).map((v) => this._mkRow(v))
    this.cursor = 0
    this._syncFocus()
    return this
  }

  isEmpty(v) {
    return !Array.isArray(v) || v.length === 0
  }

  update(msg) {
    if (!this._focused || !msg || msg.type !== 'key') return [this, null]
    const row = this.rows[this.cursor]

    if (key.matches(msg, keys.up)) {
      this._move(-1)
      return [this, null]
    }
    if (key.matches(msg, keys.down)) {
      this._move(1)
      return [this, null]
    }
    if (key.matches(msg, keys.add)) {
      this._addRow()
      return [this, null]
    }
    // Backspace on an EMPTY row removes it; otherwise it edits (deletes a char).
    if (
      key.matches(msg, keys.back) &&
      row &&
      row.value === '' &&
      this.rows.length > this._floor()
    ) {
      this._removeRow()
      return [this, null]
    }

    const [c] = row.update(msg)
    this.rows[this.cursor] = c
    if (this.error) this.error = null
    return [this, null]
  }

  _move(delta) {
    this.cursor = Math.max(0, Math.min(this.cursor + delta, this.rows.length - 1))
    this._syncFocus()
  }

  _addRow() {
    if (this.max && this.rows.length >= this.max) return
    this.rows.splice(this.cursor + 1, 0, this._mkRow(''))
    this.cursor++
    this._syncFocus()
  }

  _removeRow() {
    this.rows.splice(this.cursor, 1)
    this.cursor = Math.max(0, Math.min(this.cursor, this.rows.length - 1))
    this._syncFocus()
    if (this.error) this.error = null
  }

  _syncFocus() {
    this.rows.forEach((r, i) => (this._focused && i === this.cursor ? r.focus() : r.blur()))
  }

  controlView() {
    const t = this.theme
    const lines = this.rows.map((r, i) => {
      const pointer = this._focused && i === this.cursor ? '› ' : '  '
      return pointer + r.view()
    })
    if (this._focused) lines.push(t.help('  ↵ add · ⌫ on an empty row removes'))
    return lines.join('\n')
  }
}

function list(opts) {
  return new ListField(opts)
}

module.exports = { list, ListField, keys }
