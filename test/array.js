// Tests for arrays of objects: a repeatable subform the user grows/shrinks. The
// engine rebuilds the flat field list on add/remove, preserving each entry's
// values by a stable id (so removing the middle entry shifts the rest cleanly),
// and value() materializes a real array.
const { test } = require('brittle')
const form = require('..')
const { typed, key, submit, stripAnsi } = require('./helpers')

const TEAM = {
  type: 'object',
  title: 'Team',
  properties: {
    members: {
      type: 'array',
      title: 'Members',
      minItems: 1,
      maxItems: 3,
      items: {
        type: 'object',
        title: 'Member',
        required: ['name'],
        properties: {
          name: { type: 'string', title: 'Name' },
          role: { type: 'string', title: 'Role', enum: ['dev', 'pm'] }
        }
      }
    }
  }
}

const paths = (f) => f.fields.map((x) => x.path.join('.') + (x.isButton ? '[btn]' : ''))
const addBtn = (f) => f.fields.find((x) => x.isButton && x.action.kind === 'array.add')
const removeBtn = (f, pos) =>
  f.fields.find((x) => x.isButton && x.action.kind === 'array.remove' && x.path[1] === String(pos))
const leaf = (f, p) => f.fields.find((x) => x.path.join('.') === p)

test('array: starts at minItems with an add button; value is an array', (t) => {
  const f = form.fromSchema(TEAM)
  t.alike(paths(f), ['members.0.name', 'members.0.role', 'members.$add[btn]'], 'one entry + add')
  t.absent(removeBtn(f, 0), 'no remove button at minItems')
  t.alike(f.value(), { members: [{ name: '', role: null }] }, 'value is an array of objects')
})

test('array: an empty (minItems 0) array still emits []', (t) => {
  const f = form.fromSchema({
    type: 'object',
    properties: {
      tags: { type: 'array', items: { type: 'object', properties: { v: { type: 'string' } } } }
    }
  })
  t.alike(f.value(), { tags: [] }, 'empty array present as []')
  t.ok(addBtn(f), 'add button shown')
})

test('array: add grows the form and collects each entry', (t) => {
  const f = form.fromSchema(TEAM)
  leaf(f, 'members.0.name').setValue('Ada')
  f._activate(addBtn(f))
  t.ok(leaf(f, 'members.1.name'), 'second entry built')
  t.ok(removeBtn(f, 0) && removeBtn(f, 1), 'remove buttons appear once above minItems')
  leaf(f, 'members.1.name').setValue('Bo')
  t.alike(f.value(), {
    members: [
      { name: 'Ada', role: null },
      { name: 'Bo', role: null }
    ]
  })
})

test('array: maxItems caps growth and hides the add button', (t) => {
  const f = form.fromSchema(TEAM) // max 3
  f._activate(addBtn(f))
  f._activate(addBtn(f))
  t.is(
    f.fields.filter((x) => x.path.length === 3 && x.path[2] === 'name').length,
    3,
    'three entries'
  )
  t.absent(addBtn(f), 'add button gone at maxItems')
  const before = f.value().members.length
  // a stray activate at the cap is a no-op (there is no add button to press)
  t.is(before, 3, 'capped at 3')
})

test('array: removing the middle entry shifts the rest, keeping their values', (t) => {
  const f = form.fromSchema(TEAM)
  leaf(f, 'members.0.name').setValue('Ada')
  f._activate(addBtn(f))
  leaf(f, 'members.1.name').setValue('Bo')
  f._activate(addBtn(f))
  leaf(f, 'members.2.name').setValue('Cy')

  f._activate(removeBtn(f, 1)) // remove Bo (middle)
  t.alike(
    f.value().members.map((m) => m.name),
    ['Ada', 'Cy'],
    'survivors keep their values and renumber by position'
  )
})

test('array: a required field inside an entry blocks submit, keyed by path', (t) => {
  const f = form.fromSchema(TEAM) // members.0.name required, empty
  const [, cmd] = f.submit()
  t.is(cmd, null, 'blocked')
  t.is(f.errors()['members.0.name'], 'required', 'error keyed by entry path')
})

test('array: rehydration sizes the array to the data and round-trips', (t) => {
  const data = {
    members: [
      { name: 'Ada', role: 'dev' },
      { name: 'Bo', role: 'pm' }
    ]
  }
  const f = form.fromSchema(TEAM, { formData: data })
  t.is(f.value().members.length, 2, 'sized to the data')
  t.alike(f.value(), data, 'round-trips')
})

test('array: enter on the add button adds (and focuses the new entry)', (t) => {
  const f = form.fromSchema(TEAM)
  const i = f.ring.items.indexOf(addBtn(f))
  f.ring.focus(i)
  f.update(key('enter'))
  t.ok(leaf(f, 'members.1.name'), 'entry added via enter on the button')
  t.is(f.ring.focused().path.join('.'), 'members.1.name', 'focus moved into the new entry')
})

test('array: the submit key commits a form that ends in an add button', (t) => {
  const f = form.fromSchema({
    type: 'object',
    properties: {
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 2,
        items: { type: 'object', properties: { v: { type: 'string' } } }
      }
    }
  })
  // Focus the add button and press enter: it adds (does not submit) — this is
  // exactly why submit is its own key.
  f.ring.focus(f.ring.items.indexOf(addBtn(f)))
  const [, added] = f.update(key('enter'))
  t.is(added, null, 'enter on the add button adds, never submits')
  t.is(f.value().items.length, 2, 'an entry was added')
  // The dedicated submit key commits from anywhere.
  const [, cmd] = f.update(submit())
  t.ok(typeof cmd === 'function', 'submit key commits the form')
})

test('array: editing an entry survives adding another (instance preserved)', (t) => {
  const f = form.fromSchema(TEAM)
  leaf(f, 'members.0.name').setValue('Ada')
  f._activate(addBtn(f))
  t.is(leaf(f, 'members.0.name').value(), 'Ada', 'first entry value preserved across rebuild')
})

test('array: entry headers render in the view', (t) => {
  const f = form.fromSchema(TEAM)
  f._activate(addBtn(f))
  const v = stripAnsi(f.view())
  t.ok(v.includes('Member 1') && v.includes('Member 2'), 'numbered entry headers shown')
  t.ok(v.includes('+ Add'), 'add button shown')
})

test('array: primitive-item and nested arrays are refused', (t) => {
  t.exception(
    () =>
      form.fromSchema({
        type: 'object',
        properties: { xs: { type: 'array', items: { type: 'string' } } }
      }),
    /items\.enum or object items/,
    'array of primitives refused'
  )
  t.exception(
    () =>
      form.fromSchema({
        type: 'object',
        properties: {
          grid: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                row: {
                  type: 'array',
                  items: { type: 'object', properties: { c: { type: 'string' } } }
                }
              }
            }
          }
        }
      }),
    /nested arrays/,
    'array nested inside an array item refused'
  )
})

test('array: maxItems is capped by the security limit', (t) => {
  const f = form.fromSchema(
    {
      type: 'object',
      properties: {
        xs: {
          type: 'array',
          maxItems: 9999,
          items: { type: 'object', properties: { v: { type: 'string' } } }
        }
      }
    },
    { limits: { maxArrayItems: 4 } }
  )
  const state = f._arrays.get('xs')
  t.is(state.maxItems, 4, 'maxItems clamped to the limit')
})

// touch `typed` so the helper set matches the other suites
test('array: typing into an entry field collects under its index', (t) => {
  const f = form.fromSchema(TEAM)
  f.ring.focus(f.ring.items.indexOf(leaf(f, 'members.0.name')))
  f.update(typed('A'))
  t.is(f.value().members[0].name, 'A')
})
