// Unit tests for the individual field types: value handling and validation.
const { test } = require('brittle')
const form = require('..')
const { typed, key, space, stripAnsi } = require('./helpers')

test('text: value, setValue, and required validation', (t) => {
  const f = form.text({ name: 'name', required: true }).focus()

  t.is(f.value(), '', 'starts empty')
  t.is(f.validate(), 'required', 'required + empty → error')

  for (const c of 'Ada') f.update(typed(c))
  t.is(f.value(), 'Ada', 'typing updates the value')
  t.is(f.validate(), null, 'non-empty passes')
})

test('text: custom validate runs after required', (t) => {
  const f = form
    .text({ name: 'email', validate: (v) => (v.includes('@') ? null : 'need an @') })
    .focus()
  for (const c of 'nope') f.update(typed(c))
  t.is(f.validate(), 'need an @', 'custom validator reports the error')
  f.setValue('a@b')
  t.is(f.validate(), null, 'and clears when satisfied')
})

test('number: coercion and numeric validation', (t) => {
  const f = form.number({ name: 'age', min: 0, max: 120, integer: true }).focus()

  t.is(f.value(), null, 'blank → null')
  t.is(f.validate(), null, 'blank is fine when optional')

  f.setValue('3.5')
  t.is(f.value(), 3.5, 'parses a number')
  t.is(f.validate(), 'must be a whole number', 'integer constraint enforced')

  f.setValue('200')
  t.is(f.validate(), 'must be ≤ 120', 'max constraint enforced')

  f.setValue('30')
  t.is(f.validate(), null, 'a valid integer in range passes')
  t.is(f.value(), 30, 'value() returns a Number')
})

test('number: non-numeric text is flagged', (t) => {
  const f = form.number({ name: 'n' }).focus()
  for (const c of 'abc') f.update(typed(c))
  t.is(f.validate(), 'must be a number', 'NaN reported')
})

test('confirm: required means must be checked', (t) => {
  const f = form.confirm({ name: 'tos', label: 'agree', required: true }).focus()

  t.is(f.value(), false, 'starts unchecked')
  t.is(f.validate(), 'required', 'required + unchecked → error')

  f.update(space())
  t.is(f.value(), true, 'space toggles on')
  t.is(f.validate(), null, 'checked passes')
})

test('confirm: renders its label once (on the checkbox line), not twice', (t) => {
  const f = form.confirm({ name: 'tos', label: 'Accept terms', required: true }).focus()
  const view = stripAnsi(f.view())
  const count = (view.match(/Accept terms/g) || []).length
  t.is(count, 1, 'the label appears exactly once')
  t.ok(/\[\s?\]\s+Accept terms/.test(view), 'label rides on the checkbox line')
  t.ok(view.includes('*'), 'required marker shown')
  t.ok(f.hideLabel, 'the separate label row is suppressed')
})

test('select / radio: value() reflects the choice', (t) => {
  const s = form.select({ name: 's', options: ['a', 'b', 'c'] }).focus()
  t.is(s.value(), null, 'select starts unchosen')
  s.update(space()) // open
  s.update(key('down'))
  s.update(key('enter')) // commit 'b'
  t.is(s.value(), 'b', 'select commits the highlighted option')

  const r = form.radio({ name: 'r', options: ['x', 'y'], selected: 1 }).focus()
  t.is(r.value(), 'y', 'radio reflects initial selection')
  r.update(key('up'))
  t.is(r.value(), 'x', 'arrows move the radio')
})

test('select: wantsEnter only while the menu is open', (t) => {
  const s = form.select({ name: 's', options: ['a', 'b'] }).focus()
  t.absent(s.wantsEnter(), 'closed → enter belongs to the form')
  s.update(space())
  t.ok(s.wantsEnter(), 'open → enter belongs to the menu')
})

test('multiselect: toggle, value, and setValue', (t) => {
  const f = form
    .multiselect({
      name: 'langs',
      options: [
        { label: 'JS', value: 'js' },
        { label: 'Go', value: 'go' },
        { label: 'Rust', value: 'rs' }
      ]
    })
    .focus()

  t.alike(f.value(), [], 'starts empty')
  f.update(space()) // toggle JS (cursor 0)
  f.update(key('down'))
  f.update(key('down'))
  f.update(space()) // toggle Rust (cursor 2)
  t.alike(f.value(), ['js', 'rs'], 'checked values in option order')

  f.setValue(['go'])
  t.alike(f.value(), ['go'], 'setValue replaces the checked set')
})

test('multiselect: required needs at least one', (t) => {
  const f = form.multiselect({ name: 'x', options: ['a', 'b'], required: true }).focus()
  t.is(f.validate(), 'required', 'empty array fails required')
  f.update(space())
  t.is(f.validate(), null, 'one checked passes')
})

test('textarea: captures enter (so the form does not advance on it)', (t) => {
  const f = form.textarea({ name: 'bio' })
  t.ok(f.wantsEnter(), 'textarea wants enter for newlines')
})
