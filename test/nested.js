// Tests for nested objects: a schema object property becomes a sub-section.
// Required objects are always-included subforms (a header + indented fields);
// non-required objects are optional sections gated by a checkbox that the user
// (or auto-arming on input) turns on, and that omits the subtree when off.
const { test } = require('brittle')
const form = require('..')
const { typed, space, stripAnsi } = require('./helpers')

// name, address{street,city} (required), billing{card} (optional, card required)
function build() {
  return form.fromSchema({
    type: 'object',
    title: 'Account',
    required: ['name', 'address'],
    properties: {
      name: { type: 'string' },
      address: {
        type: 'object',
        title: 'Address',
        required: ['street'],
        properties: { street: { type: 'string' }, city: { type: 'string' } }
      },
      billing: {
        type: 'object',
        title: 'Billing',
        required: ['card'],
        properties: { card: { type: 'string' } }
      }
    }
  })
}

test('nested: required object flattens to paths, no gate', (t) => {
  const f = build()
  // flat focusable fields, depth-first: name, street, city, billing-gate, card
  t.alike(
    f.fields.map((x) => x.path.join('.')),
    ['name', 'address.street', 'address.city', 'billing', 'billing.card'],
    'fields carry full paths, depth-first'
  )
  t.absent(f.fields[1].isSection, 'a required object is a plain subform, not a gate')
  t.ok(f.fields[3].isSection, 'the optional object has a section gate')
})

test('nested: value() builds the nested object; required section always included', (t) => {
  const f = build()
  f.fields[0].setValue('Ada') // name
  f.fields[1].setValue('12 King St') // address.street
  // billing gate off (default), so billing is omitted entirely
  t.alike(
    f.value(),
    { name: 'Ada', address: { street: '12 King St', city: '' } },
    'required address included (even empty city); optional billing omitted while off'
  )
})

test('nested: turning the gate on includes the optional subtree', (t) => {
  const f = build()
  f.fields[0].setValue('Ada')
  f.fields[1].setValue('12 King St')
  f.fields[3].setValue(true) // arm billing
  t.alike(f.value(), {
    name: 'Ada',
    address: { street: '12 King St', city: '' },
    billing: { card: '' }
  })
})

test('nested: typing inside an optional section auto-arms its gate', (t) => {
  const f = build()
  const gate = f.fields[3]
  t.absent(gate.checked, 'gate starts off')
  f.ring.focus(4) // focus billing.card
  f.update(typed('4'))
  f.update(typed('2'))
  t.ok(gate.checked, 'editing a field in the section armed the gate')
  t.is(f.value().billing.card, '42', 'and its value is collected')
})

test('nested: an off optional section is not validated; an armed one is', (t) => {
  const f = build()
  f.fields[0].setValue('Ada')
  f.fields[1].setValue('12 King St') // satisfy required address.street

  // billing off → its required card is not enforced; submit succeeds.
  const [, cmd] = f.submit()
  t.ok(typeof cmd === 'function', 'submits with the optional section left off')
  t.absent('billing' in cmd().values, 'omitted from the submitted values')

  // arm billing with card still empty → now its required card blocks submit.
  const f2 = build()
  f2.fields[0].setValue('Ada')
  f2.fields[1].setValue('12 King St')
  f2.fields[3].setValue(true)
  const [, cmd2] = f2.submit()
  t.is(cmd2, null, 'armed section with a missing required field blocks submit')
  t.is(f2.errors()['billing.card'], 'required', 'error keyed by dotted path')
})

test('nested: required field inside a required subform blocks and reports by path', (t) => {
  const f = build()
  f.fields[0].setValue('Ada') // name ok, address.street still empty
  const [, cmd] = f.submit()
  t.is(cmd, null, 'blocked on the nested required field')
  t.is(f.errors()['address.street'], 'required', 'error keyed by dotted path')
  t.is(f.ring.index, 1, 'focus jumped to the offending nested field')
})

test('nested: setValues rehydrates nested values and arms present sections', (t) => {
  const f = build()
  f.setValues({ name: 'Ada', address: { street: 'X', city: 'Y' }, billing: { card: '4242' } })
  t.ok(f.fields[3].checked, 'billing present in data → gate armed')
  t.alike(f.value(), {
    name: 'Ada',
    address: { street: 'X', city: 'Y' },
    billing: { card: '4242' }
  })
})

test('nested: setValues leaves an absent optional section off', (t) => {
  const f = build()
  f.setValues({ name: 'Ada', address: { street: 'X', city: 'Y' } })
  t.absent(f.fields[3].checked, 'billing absent → gate stays off')
  t.absent('billing' in f.value(), 'and it is omitted from value()')
})

test('nested: formData rehydration through fromSchema round-trips', (t) => {
  const formData = { name: 'Ada', address: { street: 'X', city: 'Y' }, billing: { card: '1' } }
  const f = form.fromSchema(
    {
      type: 'object',
      required: ['name', 'address'],
      properties: {
        name: { type: 'string' },
        address: {
          type: 'object',
          required: ['street'],
          properties: { street: { type: 'string' }, city: { type: 'string' } }
        },
        billing: { type: 'object', properties: { card: { type: 'string' } } }
      }
    },
    { formData }
  )
  t.alike(f.value(), formData, 'nested formData round-trips')
})

test('nested: section title renders as a heading in the view', (t) => {
  const v = stripAnsi(build().view())
  t.ok(v.includes('Address'), 'required section heading shown')
  t.ok(v.includes('Billing'), 'optional section gate (heading) shown')
})

test('nested: hand-built nested form via { type: object } defs', (t) => {
  const f = form.create({
    fields: [
      { type: 'text', name: 'a' },
      { type: 'object', name: 'grp', title: 'Group', fields: [{ type: 'text', name: 'b' }] }
    ]
  })
  t.alike(
    f.fields.map((x) => x.path.join('.')),
    ['a', 'grp.b'],
    'hand-built nesting flattens with paths too'
  )
  f.fields[0].setValue('x')
  f.fields[1].setValue('y')
  t.alike(f.value(), { a: 'x', grp: { b: 'y' } })
})

test('nested: depth cap is enforced', (t) => {
  const deep = {
    type: 'object',
    properties: {
      a: {
        type: 'object',
        properties: { b: { type: 'object', properties: { c: { type: 'string' } } } }
      }
    }
  }
  // a→b→c is two object-nesting levels: maxDepth 1 rejects the second, 2 allows it.
  t.exception(() => form.fromSchema(deep, { limits: { maxDepth: 1 } }), /deeper than/)
  t.ok(form.fromSchema(deep, { limits: { maxDepth: 8 } }), 'within the cap it builds')
})

test('nested: field cap counts leaves across the whole tree', (t) => {
  const schema = {
    type: 'object',
    properties: {
      g1: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } } },
      g2: { type: 'object', properties: { c: { type: 'string' }, d: { type: 'string' } } }
    }
  }
  t.exception(() => form.fromSchema(schema, { limits: { maxFields: 3 } }), /over the limit/)
  t.ok(form.fromSchema(schema, { limits: { maxFields: 4 } }), '4 leaves under a cap of 4 is fine')
})

test('nested: a flat form is unchanged (paths are single-segment)', (t) => {
  const f = form.create({
    fields: [form.text({ name: 'x' }), form.confirm({ name: 'y' })]
  })
  t.alike(
    f.fields.map((p) => p.path.join('.')),
    ['x', 'y'],
    'flat fields have single-segment paths'
  )
  f.fields[0].setValue('hi')
  f.fields[1].setValue(true)
  t.alike(f.value(), { x: 'hi', y: true }, 'flat value() shape is identical to before')
})

test('nested: gate toggles with space when focused', (t) => {
  const f = build()
  f.ring.focus(3) // the billing gate
  f.update(space())
  t.ok(f.fields[3].checked, 'space arms the focused gate')
})
