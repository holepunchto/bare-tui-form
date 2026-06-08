// End-to-end tests for form.run(): drive the real Program/decoder with injected
// streams and assert on the resolved result.
const { test } = require('brittle')
const { PassThrough, Writable } = require('bare-stream')
const form = require('..')

function harness() {
  const input = new PassThrough()
  const output = new Writable({ write: (d, e, cb) => cb() })
  return { input, output, isTTY: true, width: 80, height: 24, fps: 0 }
}

test('run: resolves with values on submit', async (t) => {
  const opts = harness()
  const f = form.create({ fields: [form.text({ name: 'greeting' })] })
  const done = form.run(f, opts)

  opts.input.write('h')
  opts.input.write('i')
  opts.input.write('\x13') // ctrl+s → submit (enter no longer submits)

  const result = await done
  t.alike(result, { greeting: 'hi' }, 'typed value submitted')
})

test('run: resolves null on cancel (ctrl+c)', async (t) => {
  const opts = harness()
  const f = form.create({ fields: [form.text({ name: 'greeting' })] })
  const done = form.run(f, opts)

  opts.input.write('x')
  opts.input.write('\x03') // ctrl+c → cancel

  const result = await done
  t.is(result, null, 'cancel resolves null')
})

test('run: tab moves between fields before submit', async (t) => {
  const opts = harness()
  const f = form.create({
    fields: [form.text({ name: 'first' }), form.text({ name: 'last' })]
  })
  const done = form.run(f, opts)

  opts.input.write('A')
  opts.input.write('\t') // tab → next field
  opts.input.write('B')
  opts.input.write('\x13') // ctrl+s → submit

  const result = await done
  t.alike(result, { first: 'A', last: 'B' }, 'values captured across fields')
})
