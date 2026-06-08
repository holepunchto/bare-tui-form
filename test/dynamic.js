// Tests for the dynamic trio: oneOf/anyOf variants and if/then/else conditionals.
// These exercise the engine's value-driven active field sets — a selector or a
// controller value changes which fields are live, focusable, collected, and
// validated — plus the schema mapping onto them.
const { test } = require('brittle')
const form = require('..')
const { typed, key, space, stripAnsi } = require('./helpers')

const VARIANT = {
  type: 'object',
  title: 'Payment',
  properties: {
    method: {
      title: 'Payment method',
      oneOf: [
        {
          title: 'Credit card',
          properties: { kind: { const: 'card' }, number: { type: 'string', title: 'Card number' } }
        },
        {
          title: 'PayPal',
          properties: { kind: { const: 'paypal' }, email: { type: 'string', title: 'Email' } }
        }
      ]
    }
  }
}

test('variant: builds a selector + per-branch fields under the property path', (t) => {
  const f = form.fromSchema(VARIANT)
  t.alike(
    f.fields.map((x) => x.path.join('.')),
    ['method', 'method.kind', 'method.number', 'method.kind', 'method.email'],
    'selector at the property path, each branch nested beneath it'
  )
  const sel = f.fields[0]
  t.ok(sel.isSelector, 'first field is the variant selector')
  t.is(f.fields[1].constructor.name, 'ConstField', 'const discriminator is a const field')
  t.absent(f.fields[1].focusable, 'const is not focusable')
})

test('variant: only the selected branch is live, focusable, and collected', (t) => {
  const f = form.fromSchema(VARIANT)
  // Default branch 0 (card): selector + const + number active; email hidden.
  t.alike(
    f.activeFields.map((x) => x.path.join('.')),
    ['method', 'method.kind', 'method.number'],
    'branch 0 active set'
  )
  t.alike(
    f.ring.items.map((x) => x.path.join('.')),
    ['method', 'method.number'],
    'ring skips the non-focusable const and the hidden branch'
  )
  t.alike(f.value(), { method: { kind: 'card', number: '' } }, 'branch 0 value shape')

  f.fields[0].setValue(1) // pick PayPal
  f._recompute()
  t.alike(
    f.activeFields.map((x) => x.path.join('.')),
    ['method', 'method.kind', 'method.email'],
    'branch 1 active set'
  )
  t.alike(f.value(), { method: { kind: 'paypal', email: '' } }, 'branch 1 value shape')
})

test('variant: switching the selector live via keystrokes reshapes the form', (t) => {
  const f = form.fromSchema(VARIANT)
  // selector is focused at index 0; open it, move down, commit → branch 1.
  f.update(space())
  f.update(key('down'))
  f.update(key('enter'))
  t.is(f.fields[0].value(), 1, 'selector now on PayPal')
  t.ok(
    f.ring.items.some((x) => x.path.join('.') === 'method.email'),
    'PayPal email is now in the ring'
  )
  t.absent(
    f.ring.items.some((x) => x.path.join('.') === 'method.number'),
    'card number dropped out of the ring'
  )
})

test('variant: only the live branch is validated on submit', (t) => {
  const schema = {
    type: 'object',
    properties: {
      method: {
        title: 'Method',
        oneOf: [
          { title: 'Card', properties: { number: { type: 'string' } }, required: ['number'] },
          { title: 'Cash', properties: { note: { type: 'string' } } }
        ]
      }
    }
  }
  const f = form.fromSchema(schema)
  // Branch 0 requires number; empty → blocked.
  const [, cmd] = f.submit()
  t.is(cmd, null, 'blocked on the live branch required field')
  t.is(f.errors()['method.number'], 'required')

  // Switch to Cash (branch 1): the card requirement no longer applies.
  f.fields[0].setValue(1)
  f._recompute()
  const [, cmd2] = f.submit()
  t.ok(typeof cmd2 === 'function', 'submits once the requiring branch is inactive')
  t.alike(cmd2().values, { method: { note: '' } }, 'only the live branch contributes')
})

test('variant: rehydration infers the branch from the data shape', (t) => {
  const f = form.fromSchema(VARIANT, { formData: { method: { kind: 'paypal', email: 'a@b.co' } } })
  t.is(f.fields[0].value(), 1, 'selector pointed at the matching branch')
  t.alike(f.value(), { method: { kind: 'paypal', email: 'a@b.co' } }, 'and the values round-trip')
})

test('variant: anyOf is treated like oneOf (pick one)', (t) => {
  const f = form.fromSchema({
    type: 'object',
    properties: {
      x: {
        anyOf: [
          { title: 'A', properties: { a: { type: 'string' } } },
          { title: 'B', properties: { b: { type: 'string' } } }
        ]
      }
    }
  })
  t.ok(f.fields[0].isSelector, 'anyOf also builds a single-choice selector')
})

test('variant: all-scalar oneOf collapses to a plain select', (t) => {
  const f = form.fromSchema({
    type: 'object',
    properties: {
      size: {
        oneOf: [
          { const: 's', title: 'Small' },
          { const: 'm', title: 'Medium' }
        ]
      }
    }
  })
  t.is(f.fields[0].constructor.name, 'SelectField', 'scalar branches → select, not variant')
  t.is(f.fields[0].control.options[0].label, 'Small', 'branch titles become option labels')
  f.fields[0].setValue('m')
  t.alike(f.value(), { size: 'm' }, 'select value is the chosen const')
})

test('variant: mixed object/scalar branches are refused', (t) => {
  t.exception(
    () =>
      form.fromSchema({
        type: 'object',
        properties: { x: { oneOf: [{ const: 'a' }, { properties: { b: { type: 'string' } } }] } }
      }),
    /all object branches or all const/
  )
})

const CONDITIONAL = {
  type: 'object',
  title: 'Shipping',
  required: ['country'],
  properties: { country: { type: 'string', title: 'Country', enum: ['US', 'UK'] } },
  if: { properties: { country: { const: 'US' } } },
  then: { properties: { zip: { type: 'string', title: 'ZIP' } }, required: ['zip'] },
  else: { properties: { postcode: { type: 'string', title: 'Postcode' } } }
}

test('conditional: if/then/else swaps the live fields on the controller value', (t) => {
  const f = form.fromSchema(CONDITIONAL)
  t.alike(
    f.fields.map((x) => x.path.join('.')),
    ['country', 'zip', 'postcode'],
    'controller + then + else fields all built'
  )
  const country = f.fields[0]

  country.setValue('US')
  f._recompute()
  t.alike(
    f.activeFields.map((x) => x.path.join('.')),
    ['country', 'zip'],
    'US → then branch (zip)'
  )

  country.setValue('UK')
  f._recompute()
  t.alike(
    f.activeFields.map((x) => x.path.join('.')),
    ['country', 'postcode'],
    'UK → else branch (postcode)'
  )
})

test('conditional: value() and validation follow the live branch', (t) => {
  const f = form.fromSchema(CONDITIONAL)
  const country = f.fields[0]

  country.setValue('UK')
  f._recompute()
  const [, cmd] = f.submit()
  t.ok(typeof cmd === 'function', 'UK: zip is not required (else branch)')
  t.alike(cmd().values, { country: 'UK', postcode: '' }, 'only the else field is collected')

  const f2 = form.fromSchema(CONDITIONAL)
  f2.fields[0].setValue('US')
  f2._recompute()
  const [, blocked] = f2.submit()
  t.is(blocked, null, 'US: then.required zip is enforced')
  t.is(f2.errors().zip, 'required')
})

test('conditional: an enum if matches any listed value', (t) => {
  const f = form.fromSchema({
    type: 'object',
    properties: { plan: { type: 'string', enum: ['free', 'pro', 'team'] } },
    if: { properties: { plan: { enum: ['pro', 'team'] } } },
    then: { properties: { seats: { type: 'integer' } } }
  })
  const plan = f.fields[0]
  plan.setValue('free')
  f._recompute()
  t.absent(
    f.activeFields.some((x) => x.key === 'seats'),
    'free → seats hidden'
  )
  plan.setValue('team')
  f._recompute()
  t.ok(
    f.activeFields.some((x) => x.key === 'seats'),
    'team → seats shown (enum match)'
  )
})

test('conditional: works nested inside an object section', (t) => {
  const f = form.fromSchema({
    type: 'object',
    required: ['acct'],
    properties: {
      acct: {
        type: 'object',
        title: 'Account',
        properties: { tier: { type: 'string', enum: ['basic', 'plus'] } },
        if: { properties: { tier: { const: 'plus' } } },
        then: { properties: { coupon: { type: 'string' } } }
      }
    }
  })
  const tier = f.fields.find((x) => x.key === 'tier')
  tier.setValue('plus')
  f._recompute()
  const coupon = f.fields.find((x) => x.key === 'coupon')
  t.ok(f.activeFields.includes(coupon), 'nested then field active')
  t.is(coupon.path.join('.'), 'acct.coupon', 'nested under the section path')
})

test('dynamic: hidden fields are not rendered', (t) => {
  const f = form.fromSchema(CONDITIONAL)
  f.fields[0].setValue('US')
  f._recompute()
  const v = stripAnsi(f.view())
  t.ok(v.includes('ZIP'), 'then field shown')
  t.absent(v.includes('Postcode'), 'else field hidden from the view')
})

test('dynamic: branch cap is enforced', (t) => {
  const branches = []
  for (let i = 0; i < 5; i++) {
    branches.push({ title: 'B' + i, properties: { ['f' + i]: { type: 'string' } } })
  }
  t.exception(
    () =>
      form.fromSchema(
        { type: 'object', properties: { x: { oneOf: branches } } },
        { limits: { maxBranches: 3 } }
      ),
    /over the limit/
  )
})

test('dynamic: a const field collects but is typed by the user only via its branch', (t) => {
  const f = form.fromSchema({
    type: 'object',
    properties: { x: { const: 42, title: 'Fixed' } }
  })
  t.is(f.fields[0].constructor.name, 'ConstField')
  t.alike(f.value(), { x: 42 }, 'const value collected')
  // typing does nothing to a const
  f.fields[0].setValue(99)
  t.is(f.value().x, 42, 'const is immutable')
})

// touch `typed` so the helper set matches the other suites and lint is quiet
test('dynamic: typing into a live branch field collects under its path', (t) => {
  const f = form.fromSchema(VARIANT)
  f.ring.focus(f.ring.items.findIndex((x) => x.path.join('.') === 'method.number'))
  f.update(typed('4'))
  f.update(typed('2'))
  t.is(f.value().method.number, '42')
})
