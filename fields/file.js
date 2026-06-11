// file — a path field you can either type or browse.
//
// It wraps bare-tui's textinput (the editable path, and the field's string
// value) and lazily opens bare-tui's filepicker as an overlay — the same
// host-the-control-and-expose-an-overlay shape as fields/select.js. The picker
// is created the first time you open it, so a form full of file fields doesn't
// pull in bare-fs until one is actually browsed.
//
// Interaction (mirrors select's "space opens, never steals enter"):
//   closed  — type a path; SPACE on an empty input opens the picker
//   open    — ↑/↓ move, →/l descend, ↵ open/select, ⌫ up a dir, esc closes
// While open the field claims enter (wantsEnter) so the form's enter reaches the
// picker instead of advancing; on a pick the chosen path fills the input.
//
// `pick: 'file' | 'dir'` chooses the picker mode. `fs`/`path`/`cwd`/`height`/
// `showHidden` are forwarded to filepicker.create — `fs`/`path` let tests inject
// filepicker.mock with no real I/O.
const { textinput, filepicker, key } = require('bare-tui')
const { Field } = require('./base')

const openKey = key.binding({ keys: ['space'] })
const closeKey = key.binding({ keys: ['esc'] })

class FileField extends Field {
  constructor(opts = {}) {
    super(opts)
    this.pick = opts.pick === 'dir' ? 'dir' : 'file'
    this.input = textinput.create({
      value: opts.value || '',
      placeholder:
        opts.placeholder ||
        (this.pick === 'dir' ? 'choose a directory…' : 'type a path or browse…'),
      prompt: opts.prompt ?? '> ',
      charLimit: opts.charLimit || 0
    })
    // The base delegates focus()/blur()/`focused` to this.control — point it at
    // the text input (the picker is a transient overlay, not the resting state).
    this.control = this.input
    this._pickerOpts = {
      pick: this.pick,
      cwd: opts.cwd,
      height: opts.height,
      showHidden: opts.showHidden,
      fs: opts.fs,
      path: opts.path
    }
    this.picker = null
  }

  value() {
    return this.input.value
  }

  setValue(v) {
    this.input.setValue(v === null || v === undefined ? '' : v)
    return this
  }

  // While the picker is open, enter belongs to it (descend/select), so the form
  // must not treat enter as confirm/advance.
  get isOpen() {
    return this.picker !== null
  }

  wantsEnter() {
    return this.isOpen
  }

  update(msg) {
    if (this.picker) return this._updateOpen(msg)

    // Closed: SPACE on an empty input opens the browser; otherwise the text
    // input handles the key (so you can type, and type spaces in a real path).
    if (msg && msg.type === 'key' && key.matches(msg, openKey) && this.input.value === '') {
      return this._open()
    }
    const [c, cmd] = this.input.update(msg)
    this.input = c
    if (this.error) this.error = null
    return [this, cmd]
  }

  _updateOpen(msg) {
    if (msg && msg.type === 'filepicker.select') {
      this.setValue(msg.path)
      this.picker = null
      this.error = null
      return [this, null]
    }
    if (msg && msg.type === 'key' && key.matches(msg, closeKey)) {
      this.picker = null
      return [this, null]
    }
    const [p, cmd] = this.picker.update(msg)
    this.picker = p
    return [this, cmd]
  }

  _open() {
    this.picker = filepicker.create(this._pickerOpts)
    // The first directory read is a Cmd; thread it up so the form/program runs it.
    return [this, this.picker.init()]
  }

  // Tab-away (or any focus change) closes the overlay so it can't linger.
  blur() {
    this.picker = null
    return super.blur()
  }

  menuView() {
    return this.picker ? this.picker.view() : ''
  }

  controlView() {
    const view = this.input.view()
    if (this.isOpen) return view
    const hint = this.theme.help(
      this.pick === 'dir' ? '  space to browse folders' : '  space to browse'
    )
    return view + '\n' + hint
  }
}

function file(opts) {
  return new FileField(opts)
}

module.exports = { file, FileField }
