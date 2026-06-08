// Tests for theming: the form merges a partial theme over the defaults and every
// field renders its chrome through it.
const { test } = require('brittle')
const { spinner } = require('bare-tui')
const form = require('..')
const { key, stripAnsi, asyncCheck } = require('./helpers')

test('theme: label/error functions and markers are applied', (t) => {
  const f = form.create({
    theme: {
      label: (s) => 'L:' + s,
      labelFocused: (s) => 'F:' + s,
      error: (s) => 'E:' + s,
      requiredMarker: '(req)',
      errorPrefix: '! '
    },
    fields: [
      form.text({ name: 'a', label: 'Name', required: true }),
      form.text({ name: 'b', label: 'Other' })
    ]
  })

  const [a, b] = f.fields
  t.ok(
    stripAnsi(a.view()).includes('F:Name(req)'),
    'focused field uses labelFocused + requiredMarker'
  )
  t.ok(stripAnsi(b.view()).includes('L:Other'), 'blurred field uses label')

  f.update(key('enter')) // required + empty → error on the focused field
  t.ok(stripAnsi(a.view()).includes('E:! required'), 'error uses errorPrefix + error fn')
})

test('theme: partial theme keeps defaults for the rest', (t) => {
  const f = form.create({
    title: 'Hi',
    theme: { title: (s) => 'T:' + s },
    fields: [form.text({ name: 'a', label: 'A' })]
  })
  t.ok(stripAnsi(f.view()).includes('T:Hi'), 'custom title applied')
  // default help footer (faint) still renders its text
  t.ok(stripAnsi(f.view()).includes('ctrl+s submit'), 'default help retained')
})

test('theme: spinner frames can be named', (t) => {
  const f = form.create({
    theme: { spinner: { frames: 'line', fps: 20 } },
    fields: [form.text({ name: 'u', validate: asyncCheck() })]
  })
  const u = f.fields[0]
  u.setValue('x')
  f.update(key('enter')) // starts the spinner
  t.alike(u.spinner.frames, spinner.line, 'named frame set resolved to the array')
  t.is(u.spinner.fps, 20, 'fps passed through')
})

test('theme: frame wraps the whole view and stays scroll-aware', (t) => {
  const frame = (s) => 'TOP\n' + s + '\nBOT' // a stand-in border: adds 2 rows
  const fields = []
  for (let i = 0; i < 20; i++) fields.push(form.text({ name: 'f' + i, label: 'F' + i }))
  const f = form.create({ theme: { frame }, fields })

  // No size yet → still wrapped, just rendered inline.
  t.ok(f.view().startsWith('TOP\n') && f.view().endsWith('\nBOT'), 'frame applied inline')

  // With a height, the frame's rows are reserved so the whole thing fits.
  f.update({ type: 'resize', width: 80, height: 12 })
  const lines = f.view().split('\n')
  t.is(lines[0], 'TOP', 'frame top row')
  t.is(lines[lines.length - 1], 'BOT', 'frame bottom row')
  t.is(lines.length, 12, 'total height fits the terminal (frame rows reserved)')

  // Follow-the-focus still works inside the frame.
  for (let i = 0; i < 11; i++) f.update(key('tab'))
  t.ok(stripAnsi(f.view()).includes('F11'), 'focused field scrolled into the framed view')
})

test('theme: form.frame builder and frames presets produce border-wrapping fns', (t) => {
  const rounded = form.frame({ border: 'rounded', padding: [0, 1] })
  t.is(typeof rounded, 'function', 'builder returns a function')
  t.ok(/[╭╮╰╯]/.test(rounded('x')), 'rounded corners drawn')
  t.ok(/[╔╗╚╝]/.test(form.frames.double('x')), 'frames.double preset')
  t.ok(/[┏┓┗┛]/.test(form.frames.thick('x')), 'frames.thick preset')
})

test('theme: a frame descriptor object is normalized to a frame function', (t) => {
  const f = form.create({
    theme: { frame: { border: 'rounded', padding: [0, 2], width: 30 } },
    fields: [form.text({ name: 'a', label: 'Name' })]
  })
  t.is(typeof f.theme.frame, 'function', 'descriptor became a function')
  t.ok(/[╭╮╰╯]/.test(f.view()), 'the form renders inside a rounded border')
})

test('theme: a preset frame stays scroll-aware', (t) => {
  const fields = []
  for (let i = 0; i < 20; i++) fields.push(form.text({ name: 'f' + i, label: 'F' + i }))
  const f = form.create({ theme: { frame: form.frames.rounded }, fields })
  f.update({ type: 'resize', width: 60, height: 14 })
  const lines = f.view().split('\n')
  t.is(lines.length, 14, 'framed form fits the terminal height')
  t.ok(/[╭╮]/.test(lines[0]), 'top border on the first row')
  t.ok(/[╰╯]/.test(lines[lines.length - 1]), 'bottom border on the last row')
})
