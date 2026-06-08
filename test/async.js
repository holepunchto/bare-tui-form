// Tests for async validation: the validating state machine, stale-result
// rejection, input gating while busy, cancel, and an end-to-end run().
const { test } = require('brittle')
const form = require('..')
const { typed, key, submit, stripAnsi, asyncCheck } = require('./helpers')

test('async: confirm enters validating, then applies the result', (t) => {
  const f = form.create({
    fields: [
      form.text({ name: 'u', validate: asyncCheck((v) => (v === 'taken' ? 'taken' : null)) }),
      form.text({ name: 'x' })
    ]
  })
  const u = f.fields[0]
  for (const c of 'taken') f.update(typed(c))

  const [, cmd] = f.update(key('enter'))
  t.ok(f.busy, 'form is busy while validating')
  t.ok(u.validating, 'field shows the validating state')
  t.ok(Array.isArray(cmd) && cmd.length === 2, 'a batch Cmd (spinner + check) is returned')
  t.is(f.ring.index, 0, 'has not advanced yet')

  // The async result comes back as a message.
  f.update({ type: 'form.validated', id: u._runId, key: 'u', error: 'taken' })
  t.absent(u.validating, 'validating cleared')
  t.absent(f.busy, 'no longer busy')
  t.is(u.error, 'taken', 'error applied')
  t.is(f.ring.index, 0, 'stays on the failed field')
})

test('async: a passing result advances', (t) => {
  const f = form.create({
    fields: [
      form.text({ name: 'u', validate: asyncCheck((v) => (v === 'taken' ? 'taken' : null)) }),
      form.text({ name: 'x' })
    ]
  })
  const u = f.fields[0]
  for (const c of 'free') f.update(typed(c))
  f.update(key('enter'))
  f.update({ type: 'form.validated', id: u._runId, key: 'u', error: null })
  t.is(u.error, null, 'no error')
  t.is(f.ring.index, 1, 'advanced to the next field')
})

test('async: a stale result is ignored', (t) => {
  const f = form.create({
    fields: [form.text({ name: 'u', validate: asyncCheck(() => 'nope') }), form.text({ name: 'x' })]
  })
  const u = f.fields[0]
  for (const c of 'abc') f.update(typed(c))
  f.update(key('enter'))

  // A result from an older run id must not touch state.
  f.update({ type: 'form.validated', id: u._runId - 1, key: 'u', error: 'stale!' })
  t.ok(u.validating, 'still validating after a stale result')
  t.absent(u.error, 'stale error not applied')
})

test('async: input is gated while validating', (t) => {
  const f = form.create({
    fields: [form.text({ name: 'u', validate: asyncCheck() }), form.text({ name: 'x' })]
  })
  const u = f.fields[0]
  for (const c of 'ab') f.update(typed(c))
  f.update(key('enter')) // now busy

  f.update(typed('z')) // should be ignored
  t.is(u.value(), 'ab', 'typing ignored while validating')
  f.update(key('tab')) // navigation ignored too
  t.is(f.ring.index, 0, 'cannot navigate away while validating')
})

test('async: spinner ticks are routed to the validating field', (t) => {
  const f = form.create({ fields: [form.text({ name: 'u', validate: asyncCheck() })] })
  const u = f.fields[0]
  f.update(typed('a'))
  f.update(key('enter'))
  t.ok(u.spinner, 'a spinner was started')
  const [, cmd] = f.update({ type: 'spinner.tick', id: u.spinner.id, tag: 0 })
  t.is(typeof cmd, 'function', 'tick advances the spinner and yields the next tick')
})

test('async: ctrl+c cancels an in-flight validation', (t) => {
  const f = form.create({ fields: [form.text({ name: 'u', validate: asyncCheck(() => 'x') })] })
  const u = f.fields[0]
  f.update(typed('a'))
  f.update(key('enter'))
  const before = u._runId

  const [, cmd] = f.update(key('c', { ctrl: true }))
  t.absent(f.busy, 'busy cleared on cancel')
  t.absent(u.validating, 'validating cleared on cancel')
  t.ok(u._runId > before, 'run id bumped so a late result is stale')
  t.alike(cmd(), { type: 'form.cancel' })
})

test('async: empty optional field skips the check and advances', (t) => {
  let called = false
  const f = form.create({
    fields: [
      form.text({
        name: 'u',
        validate: asyncCheck(() => {
          called = true
          return null
        })
      }),
      form.text({ name: 'x' })
    ]
  })
  f.update(key('enter')) // empty + optional → no async call
  t.absent(f.busy, 'did not start validating')
  t.absent(called, 'validator not called on empty optional field')
  t.is(f.ring.index, 1, 'advanced')
})

test('async: confirm runs the check; once it passes, the submit key commits', (t) => {
  const f = form.create({
    fields: [
      form.text({ name: 'u', validate: asyncCheck((v) => (v.length < 3 ? 'too short' : null)) })
    ]
  })
  const u = f.fields[0]
  for (const c of 'okay') f.update(typed(c))

  f.update(key('enter')) // confirm → kicks off the async check
  t.ok(f.busy, 'busy while the check runs')

  // The check resolves (passes) as a message; the form leaves the busy state.
  f.update({ type: 'form.validated', id: u._runId, key: 'u', error: null })
  t.absent(f.busy, 'no longer busy once the check passed')

  const [, cmd] = f.update(submit()) // deliberate submit
  t.alike(cmd(), { type: 'form.submit', values: { u: 'okay' } }, 'submits after the check passed')
})

// --- submit-time async validation -------------------------------------------

const checkResult = (f, index, value, error) => ({
  type: 'form.checkResult',
  token: f._submitToken,
  index,
  value,
  error: error || null
})

test('submit: runs a never-checked async validator, then submits when it passes', (t) => {
  const f = form.create({
    fields: [
      form.text({ name: 'u', validate: asyncCheck((v) => (v === 'taken' ? 'taken' : null)) })
    ]
  })
  for (const c of 'free') f.update(typed(c))

  // Submitting without ever confirming the field: the form validates it first.
  const [, cmd] = f.submit()
  t.ok(f._formValidating, 'entered the form-validating state')
  t.ok(Array.isArray(cmd) && cmd.length === 2, 'batch Cmd (spinner + first check)')
  t.absent(f.submitted, 'not submitted yet')

  const [, cmd2] = f.update(checkResult(f, 0, 'free', null))
  t.absent(f._formValidating, 'validation finished')
  t.ok(f.submitted, 'submitted once the check passed')
  t.alike(cmd2(), { type: 'form.submit', values: { u: 'free' } })
})

test('submit: a failing async check blocks submit and focuses the field', (t) => {
  const f = form.create({
    fields: [
      form.text({ name: 'a' }),
      form.text({ name: 'u', validate: asyncCheck((v) => (v === 'taken' ? 'taken' : null)) })
    ]
  })
  f.fields[1].setValue('taken')

  f.submit()
  const [, cmd] = f.update(checkResult(f, 0, 'taken', 'taken'))
  t.is(cmd, null, 'submit blocked')
  t.absent(f.submitted, 'not submitted')
  t.is(f.fields[1].error, 'taken', 'error applied to the field')
  t.is(f.ring.index, 1, 'focus jumped to the failing field')
})

test('submit: multiple async checks run one at a time with a k/n count', (t) => {
  const f = form.create({
    fields: [
      form.text({ name: 'a', validate: asyncCheck(() => null) }),
      form.text({ name: 'b', validate: asyncCheck(() => null) })
    ]
  })
  f.fields[0].setValue('x')
  f.fields[1].setValue('y')

  f.submit()
  t.is(f._queue.length, 2, 'two fields queued')
  t.ok(stripAnsi(f.view()).includes('1/2'), 'shows 1/2 while the first runs')

  const [, nextCmd] = f.update(checkResult(f, 0, 'x', null))
  t.absent(f.submitted, 'not done after the first')
  t.ok(nextCmd, 'a Cmd for the next check is returned (serial)')
  t.ok(stripAnsi(f.view()).includes('2/2'), 'advances to 2/2')

  const [, done] = f.update(checkResult(f, 1, 'y', null))
  t.ok(f.submitted, 'submitted after both pass')
  t.alike(done(), { type: 'form.submit', values: { a: 'x', b: 'y' } })
})

test('submit: an already-passed field is not re-checked', (t) => {
  const f = form.create({
    fields: [form.text({ name: 'u', validate: asyncCheck(() => null) })]
  })
  const u = f.fields[0]
  for (const c of 'ok') f.update(typed(c))
  f.update(key('enter')) // confirm → async
  f.update({ type: 'form.validated', id: u._runId, key: 'u', error: null }) // passes

  const [, cmd] = f.submit() // value unchanged → not dirty → no async pass
  t.absent(f._formValidating, 'no re-validation')
  t.alike(cmd(), { type: 'form.submit', values: { u: 'ok' } }, 'submits immediately')
})

test('submit: editing after a pass makes the field dirty again', (t) => {
  const f = form.create({
    fields: [form.text({ name: 'u', validate: asyncCheck(() => null) })]
  })
  const u = f.fields[0]
  for (const c of 'ok') f.update(typed(c))
  f.update(key('enter'))
  f.update({ type: 'form.validated', id: u._runId, key: 'u', error: null })
  f.update(typed('!')) // value is now 'ok!' — dirty

  f.submit()
  t.ok(f._formValidating, 're-validates the edited value')
})

test('submit: validateAsyncOnSubmit:false opts out (submits without checking)', (t) => {
  const f = form.create({
    validateAsyncOnSubmit: false,
    fields: [form.text({ name: 'u', validate: asyncCheck(() => 'always fails') })]
  })
  for (const c of 'x') f.update(typed(c))
  const [, cmd] = f.submit()
  t.absent(f._formValidating, 'no async pass')
  t.alike(cmd(), { type: 'form.submit', values: { u: 'x' } }, 'submits whatever is there')
})

test('submit: cancel during the async pass aborts and strands late results', (t) => {
  const f = form.create({
    fields: [form.text({ name: 'u', validate: asyncCheck(() => null) })]
  })
  f.fields[0].setValue('x')
  f.submit()
  const staleToken = f._submitToken

  const [, cmd] = f.update(key('c', { ctrl: true })) // cancel mid-validation
  t.ok(f.cancelled, 'cancelled')
  t.absent(f._formValidating, 'validation aborted')
  t.alike(cmd(), { type: 'form.cancel' })

  // A late result from the cancelled run is ignored.
  const [, after] = f.update({
    type: 'form.checkResult',
    token: staleToken,
    index: 0,
    value: 'x',
    error: null
  })
  t.is(after, null, 'stale result dropped')
  t.absent(f.submitted, 'did not sneak a submit through')
})
