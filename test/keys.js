// Tests for configurable keybindings and follow-the-focus scrolling.
const { test } = require('brittle')
const form = require('..')
const { typed, key, submit, stripAnsi } = require('./helpers')

test('keys: enter confirms/advances but never submits by default', (t) => {
  const f = form.create({ fields: [form.text({ name: 'a' }), form.text({ name: 'b' })] })
  for (const c of 'hi') f.update(typed(c))
  const [, cmd] = f.update(key('enter'))
  t.is(cmd, null, 'enter does not submit')
  t.is(f.ring.index, 1, 'enter advanced to the next field')
  t.absent(f.submitted, 'not submitted')
})

test('keys: the submit key commits from anywhere', (t) => {
  const f = form.create({ fields: [form.text({ name: 'a' }), form.text({ name: 'b' })] })
  f.fields[0].setValue('x')
  // focused on the first field, submit anyway
  const [, cmd] = f.update(submit())
  t.alike(cmd(), { type: 'form.submit', values: { a: 'x', b: '' } }, 'ctrl+s submits')
})

test('keys: submit is configurable (e.g. bind it to enter)', (t) => {
  const f = form.create({ keys: { submit: ['enter'] }, fields: [form.text({ name: 'a' })] })
  for (const c of 'hi') f.update(typed(c))
  const [, cmd] = f.update(key('enter'))
  t.alike(cmd(), { type: 'form.submit', values: { a: 'hi' } }, 'enter submits when bound to submit')
})

test('keys: cancel is configurable', (t) => {
  const f = form.create({ keys: { cancel: ['ctrl+x'] }, fields: [form.text({ name: 'a' })] })
  const [, cmd] = f.update(key('x', { ctrl: true }))
  t.ok(f.cancelled, 'configured cancel chord fires')
  t.alike(cmd(), { type: 'form.cancel' })
})

test('keys: next/prev are configurable and drive the ring', (t) => {
  const f = form.create({
    keys: { next: ['ctrl+n'], prev: ['ctrl+p'] },
    fields: [form.text({ name: 'a' }), form.text({ name: 'b' }), form.text({ name: 'c' })]
  })
  f.update(key('n', { ctrl: true }))
  t.is(f.ring.index, 1, 'ctrl+n advances')
  f.update(key('n', { ctrl: true }))
  t.is(f.ring.index, 2, 'again')
  f.update(key('p', { ctrl: true }))
  t.is(f.ring.index, 1, 'ctrl+p goes back')
})

test('keys: the footer advertises the configured submit chord', (t) => {
  const f = form.create({ keys: { submit: ['ctrl+y'] }, fields: [form.text({ name: 'a' })] })
  t.ok(stripAnsi(f.view()).includes('ctrl+y submit'), 'footer shows the submit key')
})

function tall() {
  const fields = []
  for (let i = 0; i < 10; i++) fields.push(form.text({ name: 'f' + i, label: 'Field' + i }))
  return form.create({ fields })
}

test('scroll: with no size the form renders everything (no scrolling)', (t) => {
  const v = stripAnsi(tall().view())
  t.ok(v.includes('Field0') && v.includes('Field9'), 'all fields rendered inline')
})

test('scroll: a known height windows the body to fit and follows focus', (t) => {
  const f = tall()
  f.update({ type: 'resize', width: 80, height: 10 })
  t.is(f.view().split('\n').length, 10, 'renders exactly the terminal height')

  let v = stripAnsi(f.view())
  t.ok(v.includes('Field0'), 'top field visible at first')
  t.absent(v.includes('Field9'), 'far field is below the fold')

  // Tab down to the last field; the window must follow focus.
  for (let i = 0; i < 9; i++) f.update(key('tab'))
  t.is(f.ring.index, 9, 'focused the last field')
  v = stripAnsi(f.view())
  t.ok(v.includes('Field9'), 'focused field scrolled into view')
  t.absent(v.includes('Field0'), 'top field scrolled off')
})

test('scroll: shrinking the window keeps the footer and a scroll hint', (t) => {
  const f = tall()
  f.update({ type: 'resize', width: 80, height: 8 })
  const v = stripAnsi(f.view())
  t.ok(v.includes('submit'), 'footer still rendered')
  t.ok(v.includes('scroll'), 'scroll hint shown when content overflows')
})
