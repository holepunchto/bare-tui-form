// Shared test helpers: craft KeyMsgs the way bare-ansi-escapes' decoder would.
const { KeyMsg } = require('bare-tui')

// A printable key (single-char sequence) — inserted as text by inputs.
const typed = (ch) => new KeyMsg({ name: ch, sequence: ch, ctrl: false, meta: false, shift: false })

// A named/control key. Pass modifiers via opts.
const key = (name, opts = {}) =>
  new KeyMsg({
    name,
    sequence: opts.sequence ?? name,
    ctrl: !!opts.ctrl,
    meta: !!opts.meta,
    shift: !!opts.shift
  })

const space = () => key('space', { sequence: ' ' })

// The default submit chord (ctrl+s) — enter no longer submits.
const submit = () => key('s', { ctrl: true })

// Strip ANSI escapes for visible-text assertions.
const { style } = require('bare-tui')
const stripAnsi = style.stripAnsi

// Build an async validator from a sync check. The form detects async validators
// by `AsyncFunction`, so test fixtures must use the async keyword; wrapping here
// (with a real await) keeps the call sites clean and lint-quiet.
const asyncCheck = (fn) => async (value) => {
  await Promise.resolve()
  return fn ? fn(value) : null
}

module.exports = { typed, key, space, submit, stripAnsi, asyncCheck }
