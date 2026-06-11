// Tests for the list field — an editable list of scalar text rows.
const { test } = require('brittle')
const form = require('..')
const { typed, key } = require('./helpers')

const chars = (f, s) => s.split('').forEach((c) => f.update(typed(c)))

test('list: type, enter to add rows, value is the non-empty entries in order', (t) => {
  const f = form.list({ name: 'tags', label: 'Tags' })
  f.focus()
  t.alike(f.value(), [], 'starts as one blank row → empty value')

  chars(f, 'red')
  f.update(key('enter')) // add a second row, focus moves to it
  chars(f, 'blue')
  t.alike(f.value(), ['red', 'blue'], 'both values collected in order')
})

test('list: ↑/↓ move between rows and edit the right one', (t) => {
  const f = form.list({ name: 'tags' })
  f.focus()
  chars(f, 'aa')
  f.update(key('enter'))
  chars(f, 'bb')
  f.update(key('up')) // back to the first row
  f.update(typed('!'))
  t.alike(f.value(), ['aa!', 'bb'], 'edited the first row, second untouched')
})

test('list: backspace on an empty row removes it; on a filled row deletes a char', (t) => {
  const f = form.list({ name: 'tags' })
  f.focus()
  chars(f, 'abc')
  f.update(key('backspace')) // row non-empty → delete a character
  t.alike(f.value(), ['ab'], 'deleted a char, row kept')
  t.is(f.rows.length, 1)

  f.update(key('enter')) // add an empty second row
  t.is(f.rows.length, 2)
  f.update(key('backspace')) // empty row → removed
  t.is(f.rows.length, 1, 'empty row removed')
  t.alike(f.value(), ['ab'])
})

test('list: never collapses below one editable row', (t) => {
  const f = form.list({ name: 'tags' })
  f.focus()
  f.update(key('backspace')) // single empty row — nothing to remove
  t.is(f.rows.length, 1, 'one row always remains')
})

test('list: respects maxItems', (t) => {
  const f = form.list({ name: 'tags', maxItems: 2 })
  f.focus()
  f.update(key('enter')) // 2 rows
  f.update(key('enter')) // capped at 2
  t.is(f.rows.length, 2, 'cannot exceed maxItems')
})

test('list: setValue rehydrates and required uses the non-empty rows', (t) => {
  const f = form.list({ name: 'tags', required: true })
  f.setValue(['one', 'two'])
  t.alike(f.value(), ['one', 'two'], 'rehydrated')
  t.is(f.requiredError(f.value()), null, 'satisfied when it has values')

  f.setValue([])
  t.is(f.requiredError(f.value()), f.requiredMessage, 'required error when empty')
})

test('list: claims enter while focused, releases it when blurred', (t) => {
  const f = form.list({ name: 'tags' })
  f.focus()
  t.ok(f.wantsEnter(), 'owns enter while focused (enter adds a row)')
  f.blur()
  t.absent(f.wantsEnter(), 'releases enter when blurred')
})
