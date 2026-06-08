// Tests for the uiSchema subset: presentation overrides, ui:order, ui:widget
// (built-in + custom registry), autofocus, readonly/hidden, and array gating.
const { test } = require('brittle')
const form = require('..')
const { stripAnsi } = require('./helpers')

const leaf = (f, key) => f.fields.find((x) => x.key === key)

test('ui: ui:order reorders properties, with * for the rest', (t) => {
  const f = form.fromSchema(
    {
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'string' },
        c: { type: 'string' },
        d: { type: 'string' }
      }
    },
    { uiSchema: { 'ui:order': ['c', '*', 'a'] } }
  )
  t.alike(
    f.fields.map((x) => x.key),
    ['c', 'b', 'd', 'a'],
    'listed names first/last, * expands to the rest in order'
  )
})

test('ui: ui:title / ui:description / ui:help / ui:placeholder override and render', (t) => {
  const f = form.fromSchema(
    { type: 'object', properties: { name: { type: 'string', title: 'Name' } } },
    {
      uiSchema: {
        name: {
          'ui:title': 'Your name',
          'ui:description': 'as on your ID',
          'ui:help': 'no nicknames',
          'ui:placeholder': 'Ada Lovelace'
        }
      }
    }
  )
  const field = leaf(f, 'name')
  t.is(field.label, 'Your name', 'ui:title overrides the schema title')
  t.is(field.description, 'as on your ID', 'ui:description applied')
  t.is(field.help, 'no nicknames', 'ui:help applied')
  t.is(field.control.placeholder, 'Ada Lovelace', 'ui:placeholder reaches the control')
  const v = stripAnsi(f.view())
  t.ok(v.includes('Your name') && v.includes('no nicknames'), 'both render')
})

test('ui: ui:label false hides the label', (t) => {
  const f = form.fromSchema(
    { type: 'object', properties: { token: { type: 'string', title: 'Token' } } },
    { uiSchema: { token: { 'ui:label': false } } }
  )
  t.ok(leaf(f, 'token').hideLabel, 'hideLabel set')
  t.absent(stripAnsi(f.view()).includes('Token'), 'label not rendered')
})

test('ui: ui:widget textarea (+rows), password, radio', (t) => {
  const f = form.fromSchema(
    {
      type: 'object',
      properties: {
        bio: { type: 'string' },
        pw: { type: 'string' },
        role: { type: 'string', enum: ['dev', 'pm'] }
      }
    },
    {
      uiSchema: {
        bio: { 'ui:widget': 'textarea', 'ui:options': { rows: 7 } },
        pw: { 'ui:widget': 'password' },
        role: { 'ui:widget': 'radio' }
      }
    }
  )
  t.is(leaf(f, 'bio').constructor.name, 'TextareaField', 'textarea widget')
  t.is(leaf(f, 'bio').control.height, 7, 'ui:options.rows sets textarea height')
  t.is(leaf(f, 'pw').control.echoMode, 'password', 'password widget masks input')
  t.is(leaf(f, 'role').constructor.name, 'RadioField', 'radio widget on an enum')
})

test('ui: ui:widget hidden collects the value but never renders or focuses', (t) => {
  const f = form.fromSchema(
    {
      type: 'object',
      properties: { id: { type: 'string', default: 'x1' }, name: { type: 'string' } }
    },
    { uiSchema: { id: { 'ui:widget': 'hidden' } } }
  )
  const id = leaf(f, 'id')
  t.ok(id.hidden, 'marked hidden')
  t.absent(f.ring.items.includes(id), 'not focusable')
  t.absent(stripAnsi(f.view()).includes('x1'), 'not rendered')
  t.is(f.value().id, 'x1', 'but still collected')
})

test('ui: ui:readonly / ui:disabled make a field non-interactive but collected', (t) => {
  const f = form.fromSchema(
    { type: 'object', properties: { plan: { type: 'string', default: 'pro' } } },
    { uiSchema: { plan: { 'ui:readonly': true } } }
  )
  const plan = leaf(f, 'plan')
  t.absent(plan.focusable, 'not focusable')
  t.absent(f.ring.items.includes(plan), 'skipped by the ring')
  t.is(f.value().plan, 'pro', 'value still collected')
})

test('ui: ui:autofocus starts focus on the chosen field', (t) => {
  const f = form.fromSchema(
    {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' } }
    },
    { uiSchema: { b: { 'ui:autofocus': true } } }
  )
  t.is(f.ring.focused().key, 'b', 'focus started on the autofocus field')
})

test('ui: a custom widget from the registry is used', (t) => {
  const widgets = {
    stars: ({ name, label }) => ({
      type: 'select',
      name,
      label,
      options: [1, 2, 3].map((n) => ({ label: '*'.repeat(n), value: n })),
      selected: 0
    })
  }
  const f = form.fromSchema(
    { type: 'object', properties: { rating: { type: 'integer' } } },
    { uiSchema: { rating: { 'ui:widget': 'stars' } }, widgets }
  )
  t.is(leaf(f, 'rating').constructor.name, 'SelectField', 'custom widget produced a select')
  t.is(f.value().rating, 1, 'its value is collected')
})

test('ui: an unknown widget falls back to the default with a warning', (t) => {
  const f = form.fromSchema(
    { type: 'object', properties: { x: { type: 'string' } } },
    { uiSchema: { x: { 'ui:widget': 'nope' } } }
  )
  t.is(leaf(f, 'x').constructor.name, 'TextField', 'fell back to the default field')
  t.ok(
    f.warnings.some((w) => w.includes('nope')),
    'and surfaced a warning'
  )
})

test('ui: a widget on the wrong type is ignored with a warning', (t) => {
  const f = form.fromSchema(
    { type: 'object', properties: { n: { type: 'integer' } } },
    { uiSchema: { n: { 'ui:widget': 'textarea' } } }
  )
  t.is(leaf(f, 'n').constructor.name, 'NumberField', 'textarea ignored on a number')
  t.ok(f.warnings.some((w) => w.includes('textarea')))
})

test('ui: array ui:options.addable / removable gate the buttons', (t) => {
  const f = form.fromSchema(
    {
      type: 'object',
      properties: {
        xs: {
          type: 'array',
          minItems: 1,
          items: { type: 'object', properties: { v: { type: 'string' } } }
        }
      }
    },
    { uiSchema: { xs: { 'ui:options': { addable: false, removable: false } } } }
  )
  t.is(f.fields.filter((x) => x.isButton).length, 0, 'no add/remove buttons')
})

test('ui: ui:options.X is equivalent to ui:X', (t) => {
  const f = form.fromSchema(
    { type: 'object', properties: { bio: { type: 'string' } } },
    { uiSchema: { bio: { 'ui:options': { widget: 'textarea', label: false } } } }
  )
  t.is(leaf(f, 'bio').constructor.name, 'TextareaField', 'widget via ui:options')
  t.ok(leaf(f, 'bio').hideLabel, 'label:false via ui:options')
})

test('ui: presentation works on nested object fields', (t) => {
  const f = form.fromSchema(
    {
      type: 'object',
      required: ['addr'],
      properties: {
        addr: { type: 'object', properties: { street: { type: 'string' } } }
      }
    },
    { uiSchema: { addr: { street: { 'ui:title': 'Street address' } } } }
  )
  t.is(leaf(f, 'street').label, 'Street address', 'nested ui:title applied')
})
