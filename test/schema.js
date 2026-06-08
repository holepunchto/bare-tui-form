// Tests for fromSchema: JSON Schema → form mapping. The mapping produces plain
// field definitions, so these mostly assert the resulting field types, options,
// constraints, required flags, and collected values.
const { test } = require('brittle')
const form = require('..')
const { typed, key, space, submit } = require('./helpers')

test('schema: object maps properties to fields with title/description/required', (t) => {
  const f = form.fromSchema({
    type: 'object',
    title: 'Account',
    description: 'Tell us about you',
    required: ['name'],
    properties: {
      name: { type: 'string', title: 'Full name' },
      bio: { type: 'string', description: 'a short bio' }
    }
  })

  t.is(f.title, 'Account', 'object title → form title')
  t.is(f.description, 'Tell us about you', 'object description → form description')
  t.is(f.fields.length, 2, 'one field per property')
  t.is(f.fields[0].constructor.name, 'TextField', 'string → text')
  t.is(f.fields[0].label, 'Full name', 'property title → label')
  t.ok(f.fields[0].required, 'listed in required[]')
  t.absent(f.fields[1].required, 'not required')
  t.is(f.fields[1].description, 'a short bio', 'description carried through')
})

test('schema: primitive types map to the right fields', (t) => {
  const f = form.fromSchema({
    type: 'object',
    properties: {
      s: { type: 'string' },
      n: { type: 'number' },
      i: { type: 'integer' },
      b: { type: 'boolean' }
    }
  })
  const names = f.fields.map((x) => x.constructor.name)
  t.alike(names, ['TextField', 'NumberField', 'NumberField', 'ConfirmField'])
  t.ok(f.fields[2].integer, 'integer sets the integer constraint')
})

test('schema: number bounds and defaults', (t) => {
  const f = form.fromSchema({
    type: 'object',
    properties: {
      age: { type: 'integer', minimum: 13, maximum: 120, default: 30 }
    }
  })
  const age = f.fields[0]
  t.is(age.value(), 30, 'default applied')
  age.setValue('200')
  t.is(age.validate(), 'must be ≤ 120', 'maximum enforced')
  age.setValue('5')
  t.is(age.validate(), 'must be ≥ 13', 'minimum enforced')
})

test('schema: enum becomes a select with labels and default', (t) => {
  const f = form.fromSchema({
    type: 'object',
    properties: {
      plan: { type: 'string', enum: ['free', 'pro'], enumNames: ['Free', 'Pro'], default: 'pro' }
    }
  })
  const plan = f.fields[0]
  t.is(plan.constructor.name, 'SelectField', 'enum → select')
  t.is(plan.value(), 'pro', 'default selected')
  t.is(plan.control.options[0].label, 'Free', 'enumNames → option labels')
})

test('schema: array + items.enum becomes a multiselect', (t) => {
  const f = form.fromSchema({
    type: 'object',
    properties: {
      tags: {
        type: 'array',
        items: { enum: ['a', 'b', 'c'] },
        default: ['b']
      }
    }
  })
  const tags = f.fields[0]
  t.is(tags.constructor.name, 'MultiSelectField', 'array+enum → multiselect')
  t.alike(tags.value(), ['b'], 'default array applied')
})

test('schema: string constraints become validation', (t) => {
  const f = form.fromSchema({
    type: 'object',
    properties: {
      user: { type: 'string', minLength: 3 },
      email: { type: 'string', format: 'email' }
    }
  })
  const [user, email] = f.fields
  user.setValue('ab')
  t.is(user.validate(), 'must be at least 3 characters', 'minLength enforced')
  email.setValue('nope')
  t.is(email.validate(), 'must be a valid email', 'format: email enforced')
  email.setValue('a@b.co')
  t.is(email.validate(), null, 'valid email passes')
})

test('schema: maxLength caps input via charLimit', (t) => {
  const f = form.fromSchema({
    type: 'object',
    properties: { pin: { type: 'string', maxLength: 4 } }
  })
  const pin = f.fields[0].focus()
  for (const c of '123456') f.fields[0].update(typed(c))
  t.is(pin.value(), '1234', 'input capped at maxLength')
})

test('schema: required object validates and collects values', (t) => {
  const f = form.fromSchema({
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string' },
      subscribe: { type: 'boolean', default: true }
    }
  })
  // submit empty → required name blocks
  const [, cmd] = f.submit()
  t.is(cmd, null, 'blocked on required name')
  t.is(f.errors().name, 'required', 'required reported')

  f.fields[0].setValue('Ada')
  const [, cmd2] = f.submit()
  t.alike(
    cmd2(),
    { type: 'form.submit', values: { name: 'Ada', subscribe: true } },
    'collected values'
  )
})

test('schema: boolean required is not forced true (JSON Schema semantics)', (t) => {
  const f = form.fromSchema({
    type: 'object',
    required: ['agree'],
    properties: { agree: { type: 'boolean' } }
  })
  t.absent(f.fields[0].required, 'boolean field is not marked required')
  const [, cmd] = f.submit()
  t.ok(typeof cmd === 'function', 'submits with the checkbox left false')
})

test('schema: single primitive schema → one-field form', (t) => {
  const f = form.fromSchema({ type: 'string', title: 'Name', default: 'Chuck' }, { name: 'name' })
  t.is(f.fields.length, 1, 'single field')
  t.is(f.fields[0].key, 'name', 'keyed by opts.name')
  t.is(f.value().name, 'Chuck', 'default applied')
})

test('schema: unsupported shapes throw clearly', (t) => {
  t.exception(
    () =>
      form.fromSchema({
        type: 'object',
        properties: { items: { type: 'array', items: { type: 'string' } } }
      }),
    /items\.enum/
  )
})

test('schema: formData rehydrates values across all field types', (t) => {
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      age: { type: 'integer' },
      plan: { type: 'string', enum: ['free', 'pro'] },
      ok: { type: 'boolean' },
      tags: { type: 'array', items: { enum: ['a', 'b', 'c'] } }
    }
  }
  const formData = { name: 'Ada', age: 30, plan: 'pro', ok: true, tags: ['a', 'c'] }
  const f = form.fromSchema(schema, { formData })
  t.alike(f.value(), formData, 'every field rehydrated and round-trips')
})

test('schema: formData overrides defaults; missing keys keep defaults', (t) => {
  const schema = {
    type: 'object',
    properties: {
      plan: { type: 'string', enum: ['free', 'pro'], default: 'free' },
      seats: { type: 'integer', default: 1 }
    }
  }
  const f = form.fromSchema(schema, { formData: { plan: 'pro' } })
  t.is(f.value().plan, 'pro', 'formData overrides the schema default')
  t.is(f.value().seats, 1, 'unspecified field keeps its default')
})

test('schema: single primitive schema rehydrates from a scalar formData', (t) => {
  const f = form.fromSchema({ type: 'string', default: 'Chuck' }, { name: 'name', formData: 'Ada' })
  t.is(f.value().name, 'Ada', 'scalar formData applied over default')
})

test('schema: end-to-end fill via keystrokes', (t) => {
  const f = form.fromSchema({
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', title: 'Name' },
      plan: { type: 'string', enum: ['free', 'pro'] },
      ok: { type: 'boolean' }
    }
  })
  for (const c of 'Ada') f.update(typed(c))
  f.update(key('enter')) // advance to select
  f.update(space()) // open
  f.update(key('down')) // → pro
  f.update(key('enter')) // commit
  f.update(key('enter')) // advance to confirm
  f.update(space()) // check
  const [, cmd] = f.update(submit())
  t.alike(cmd(), { type: 'form.submit', values: { name: 'Ada', plan: 'pro', ok: true } })
})
