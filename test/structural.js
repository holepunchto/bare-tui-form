// Tests that the presentation features uiSchema exposes are equally available to
// hand-built forms (they're plain field options), plus the form.group/form.array
// structural factories and mix-and-match.
const { test } = require('brittle')
const form = require('..')
const { stripAnsi } = require('./helpers')

const leaf = (f, p) => f.fields.find((x) => x.path.join('.') === p)

test('handbuilt: presentation options work directly on field factories', (t) => {
  const f = form.create({
    fields: [
      form.text({ name: 'a' }),
      form.text({ name: 'name', autofocus: true, placeholder: 'Ada', help: 'no nicknames' }),
      form.text({ name: 'pw', echoMode: 'password' }),
      form.textarea({ name: 'bio', rows: 6 }),
      form.text({ name: 'plan', value: 'pro', readonly: true }),
      form.text({ name: 'id', value: 'x1', hidden: true }),
      form.text({ name: 'token', label: 'Token', hideLabel: true })
    ]
  })
  t.is(f.ring.focused().key, 'name', 'autofocus honored without a schema')
  t.is(leaf(f, 'name').help, 'no nicknames', 'help')
  t.is(leaf(f, 'name').control.placeholder, 'Ada', 'placeholder')
  t.is(leaf(f, 'pw').control.echoMode, 'password', 'password echo')
  t.is(leaf(f, 'bio').control.height, 6, 'textarea rows alias → height')
  t.absent(leaf(f, 'plan').focusable, 'readonly → not focusable')
  t.absent(f.ring.items.includes(leaf(f, 'id')), 'hidden → not in ring')
  t.is(f.value().id, 'x1', 'hidden value still collected')
  t.absent(stripAnsi(f.view()).includes('Token'), 'hideLabel hides the label')
})

test('handbuilt: form.group builds a nested object section', (t) => {
  const f = form.create({
    fields: [
      form.text({ name: 'name' }),
      form.group({
        name: 'address',
        title: 'Address',
        fields: [form.text({ name: 'street' }), form.text({ name: 'city' })]
      })
    ]
  })
  t.alike(
    f.fields.map((x) => x.path.join('.')),
    ['name', 'address.street', 'address.city'],
    'group fields flatten under the group path'
  )
  leaf(f, 'address.street').setValue('12 King St')
  t.alike(f.value(), { name: '', address: { street: '12 King St', city: '' } })
})

test('handbuilt: form.group({ optional: true }) is a gated section', (t) => {
  const f = form.create({
    fields: [form.group({ name: 'billing', optional: true, fields: [form.text({ name: 'card' })] })]
  })
  const gate = f.fields.find((x) => x.isSection)
  t.ok(gate, 'optional group has a section gate')
  t.absent('billing' in f.value(), 'omitted while the gate is off')
})

test('handbuilt: form.array builds a repeatable subform', (t) => {
  const f = form.create({
    fields: [
      form.array({
        name: 'phones',
        minItems: 1,
        fields: [
          { type: 'text', name: 'label' },
          { type: 'text', name: 'number' }
        ]
      })
    ]
  })
  t.ok(leaf(f, 'phones.0.label'), 'one entry built at minItems')
  const add = f.fields.find((x) => x.isButton && x.action.kind === 'array.add')
  f._activate(add)
  leaf(f, 'phones.1.number').setValue('555')
  t.is(f.value().phones.length, 2, 'add grows the array')
  t.is(f.value().phones[1].number, '555')
})

test('handbuilt: form.array honors addable/removable', (t) => {
  const f = form.create({
    fields: [
      form.array({
        name: 'xs',
        minItems: 1,
        removable: false,
        fields: [{ type: 'text', name: 'v' }]
      })
    ]
  })
  const kinds = f.fields.filter((x) => x.isButton).map((b) => b.action.kind)
  t.alike(kinds, ['array.add'], 'add button only; removable:false drops remove')
})

test('handbuilt: form.array rejects field instances as item templates', (t) => {
  t.exception(
    () => form.array({ name: 'bad', fields: [form.text({ name: 'x' })] }),
    /plain defs/,
    'instances as item fields are refused (would bleed across entries)'
  )
})

test('handbuilt: instances, groups, and arrays mix in one fields array', (t) => {
  const f = form.create({
    fields: [
      form.text({ name: 'name', autofocus: true }),
      form.group({ name: 'addr', fields: [form.text({ name: 'city' })] }),
      form.array({ name: 'tags', fields: [{ type: 'text', name: 'label' }] })
    ]
  })
  leaf(f, 'name').setValue('Ada')
  leaf(f, 'addr.city').setValue('Lisbon')
  t.alike(f.value(), { name: 'Ada', addr: { city: 'Lisbon' }, tags: [] }, 'all three compose')
})
