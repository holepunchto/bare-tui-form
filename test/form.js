// Tests for the Form orchestration: enter advances/blocks/submits, validation
// gates, value/error collection, the overlay in view(), and fromDef.
const { test } = require('brittle')
const form = require('..')
const { typed, key, space, submit, stripAnsi } = require('./helpers')

function build() {
  return form.create({
    fields: [
      form.text({ name: 'name', label: 'Name', required: true }),
      form.select({ name: 'plan', label: 'Plan', options: ['free', 'pro'] }),
      form.confirm({ name: 'tos', label: 'Terms', required: true })
    ]
  })
}

test('form: enter blocks on an invalid required field', (t) => {
  const f = build()
  const [, cmd] = f.update(key('enter'))
  t.is(cmd, null, 'no advance/submit command')
  t.is(f.ring.index, 0, 'focus stays on the invalid field')
  t.is(f.errors().name, 'required', 'error recorded')
})

test('form: enter advances when the field is valid; the submit key commits', (t) => {
  const f = build()
  for (const c of 'Ada') f.update(typed(c))
  f.update(key('enter'))
  t.is(f.ring.index, 1, 'advanced to the select')

  // open select, pick 'pro', commit (enter is owned by the open menu)
  f.update(space())
  f.update(key('down'))
  f.update(key('enter'))
  t.is(f.fields[1].value(), 'pro', 'select committed')
  t.is(f.ring.index, 1, 'still on the select after commit (no advance)')

  f.update(key('enter')) // menu now closed → advance to confirm
  t.is(f.ring.index, 2, 'advanced to confirm')

  f.update(space()) // check terms
  const [, advance] = f.update(key('enter')) // enter does NOT submit
  t.is(advance, null, 'enter on the last field does not submit')
  t.absent(f.submitted, 'still not submitted')

  const [, cmd] = f.update(submit()) // deliberate submit key
  t.ok(typeof cmd === 'function', 'submit key emits a command')
  t.alike(cmd(), { type: 'form.submit', values: { name: 'Ada', plan: 'pro', tos: true } })
  t.ok(f.submitted, 'submitted flag set')
})

test('form: submit() jumps to the first error', (t) => {
  const f = build()
  f.fields[0].setValue('Ada') // name ok; tos still unchecked
  const [, cmd] = f.submit()
  t.is(cmd, null, 'not submitted')
  t.is(f.ring.index, 2, 'focus moved to the first errored field (tos)')
  t.is(f.errors().tos, 'required', 'tos error reported')
})

test('form: value() collects all fields by name', (t) => {
  const f = build()
  f.fields[0].setValue('Ada')
  f.fields[1].setValue('free')
  f.fields[2].setValue(true)
  t.alike(f.value(), { name: 'Ada', plan: 'free', tos: true })
})

test('form: setValues rehydrates and round-trips with value()', (t) => {
  const f = build()
  f.setValues({ name: 'Ada', plan: 'pro', tos: true })
  t.alike(f.value(), { name: 'Ada', plan: 'pro', tos: true }, 'value() returns what setValues set')
})

test('form: setValues leaves omitted fields untouched and ignores unknown keys', (t) => {
  const f = build()
  f.fields[1].setValue('free')
  f.setValues({ name: 'Ada', nope: 'ignored' })
  t.is(f.fields[0].value(), 'Ada', 'provided field updated')
  t.is(f.fields[1].value(), 'free', 'omitted field kept its value')
  t.absent('nope' in f.value(), 'unknown key not added')
})

test('form: ctrl+c emits form.cancel', (t) => {
  const f = build()
  const [, cmd] = f.update(key('c', { ctrl: true }))
  t.ok(f.cancelled, 'cancelled flag set')
  t.alike(cmd(), { type: 'form.cancel' })
})

test('form: select dropdown is overlaid in view() while open', (t) => {
  const f = build()
  f.update(typed('A'))
  f.update(key('enter')) // advance to select
  let v = stripAnsi(f.view())
  t.absent(v.includes('free\n') || v.match(/^\s*free\s*$/m), 'options hidden while closed')
  f.update(space()) // open
  v = stripAnsi(f.view())
  t.ok(v.includes('free') && v.includes('pro'), 'open menu lists options in the view')
})

test('form: fromDef builds fields from plain { type } objects', (t) => {
  const f = form.create({
    fields: [
      { type: 'text', name: 'a' },
      { type: 'number', name: 'b' },
      { type: 'select', name: 'c', options: ['x'] },
      { type: 'confirm', name: 'd' }
    ]
  })
  t.is(f.fields[0].constructor.name, 'TextField')
  t.is(f.fields[1].constructor.name, 'NumberField')
  t.is(f.fields[2].constructor.name, 'SelectField')
  t.is(f.fields[3].constructor.name, 'ConfirmField')
})

test('form: fromDef rejects an unknown type', (t) => {
  t.exception(() => form.create({ fields: [{ type: 'nope', name: 'x' }] }))
})

test('form: invalid number is caught on confirm and submit (not passed as NaN)', (t) => {
  const f = form.create({
    fields: [
      form.number({ name: 'age', min: 13, max: 120, integer: true }),
      form.text({ name: 'x' })
    ]
  })
  const age = f.fields[0]
  for (const c of 'ff') f.update(typed(c))

  // enter-confirm on the number field must block (this used to slip through).
  const [, cmd] = f.update(key('enter'))
  t.is(cmd, null, 'enter does not advance')
  t.is(f.ring.index, 0, 'stays on the number field')
  t.is(age.error, 'must be a number', 'numeric error reported on confirm')

  // and a bulk submit must catch it too, jumping focus to it.
  const f2 = form.create({ fields: [form.text({ name: 'x' }), form.number({ name: 'age' })] })
  f2.fields[1].setValue('ff')
  const [, cmd2] = f2.submit()
  t.is(cmd2, null, 'submit blocked')
  t.absent(f2.submitted, 'not submitted')
  t.is(f2.errors().age, 'must be a number', 'submit reports the numeric error')
})

test('form: a valid number submits as a Number', (t) => {
  const f = form.create({ fields: [form.number({ name: 'age', integer: true })] })
  for (const c of '42') f.update(typed(c))
  const [, cmd] = f.update(submit())
  t.alike(cmd(), { type: 'form.submit', values: { age: 42 } }, 'submits the parsed number')
})
