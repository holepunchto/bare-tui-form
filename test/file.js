// Tests for the file field — a type-or-browse path input. Driven against the
// in-memory filepicker mock, so there's no real I/O.
const { test } = require('brittle')
const { filepicker } = require('bare-tui')
const form = require('..')
const { typed, key, space } = require('./helpers')

// A FileField wired to a mock tree (fs/path/cwd forwarded to the picker on open).
function fileField(tree, opts = {}) {
  const m = filepicker.mock(tree)
  return form.file({ name: 'path', label: 'Path', fs: m.fs, path: m.path, cwd: m.root, ...opts })
}

test('file: space opens the browser and a pick fills the value', async (t) => {
  const f = fileField({ 'note.txt': null, src: {} })
  f.focus()
  t.absent(f.isOpen, 'closed initially')
  t.is(f.menuView(), '', 'no overlay when closed')

  const [, cmd] = f.update(space())
  t.ok(f.isOpen, 'space opened the picker')
  t.ok(f.wantsEnter(), 'claims enter while open')
  f.update(await cmd()) // run the initial directory read
  t.ok(f.menuView().length > 0, 'overlay renders the picker')

  f.update(key('down')) // src (dir) is first; move onto the file
  const [, selCmd] = f.update(key('enter'))
  f.update(await selCmd()) // deliver the emitted filepicker.select
  t.is(f.value(), '/note.txt', 'value filled from the pick')
  t.absent(f.isOpen, 'picker closed after a pick')
  t.is(f.menuView(), '', 'overlay gone')
})

test('file: you can type a path; space is literal once non-empty', (t) => {
  const f = fileField({})
  f.focus()
  f.update(typed('/'))
  f.update(typed('a'))
  t.is(f.value(), '/a', 'typed characters land in the value')

  f.update(space())
  t.absent(f.isOpen, 'space does not open the picker when the input is non-empty')
  t.is(f.value(), '/a ', 'space is inserted as a literal character')
})

test('file: esc closes the picker without selecting', async (t) => {
  const f = fileField({ a: {} })
  f.focus()
  const [, cmd] = f.update(space())
  f.update(await cmd())
  t.ok(f.isOpen, 'open')

  f.update(key('escape', { sequence: '\x1b' }))
  t.absent(f.isOpen, 'esc closed the picker')
  t.is(f.value(), '', 'nothing was selected')
})

test('file: blur drops a dangling overlay', async (t) => {
  const f = fileField({ a: {} })
  f.focus()
  const [, cmd] = f.update(space())
  f.update(await cmd())
  t.ok(f.isOpen, 'open')

  f.blur()
  t.absent(f.isOpen, 'blur closed the picker')
})

test('file (dir mode): enter selects the highlighted directory', async (t) => {
  const f = fileField({ src: { 'a.js': null }, 'note.txt': null }, { pick: 'dir' })
  f.focus()
  const [, cmd] = f.update(space())
  f.update(await cmd()) // cursor on "src" (dirs first)

  const [, selCmd] = f.update(key('enter'))
  f.update(await selCmd())
  t.is(f.value(), '/src', 'directory selected')
  t.absent(f.isOpen, 'closed after pick')
})

test('file: setValue / value round-trips like a string field', (t) => {
  const f = fileField({})
  f.setValue('/etc/hosts')
  t.is(f.value(), '/etc/hosts', 'value set')
  f.setValue(null)
  t.is(f.value(), '', 'null clears to empty')
})
