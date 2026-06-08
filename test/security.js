// Security tests for the untrusted-schema boundary (fromSchema + harden).
//
// A JSON Schema is treated as hostile input: these lock in that terminal-control
// characters are stripped, ReDoS patterns are refused, prototype-pollution keys
// are rejected, numeric constraints are validated, and sizes are capped — while
// a { trusted: true } caller can still opt back into full fidelity.
const { test } = require('brittle')
const form = require('..')
const harden = require('../harden')
const { typed } = require('./helpers')

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const DEL = String.fromCharCode(127)

test('security: terminal-control characters are stripped from rendered strings', (t) => {
  const f = form.fromSchema({
    type: 'object',
    title: 'Hi' + ESC + ']0;pwn' + BEL,
    description: 'd' + DEL + 'esc',
    properties: {
      name: { type: 'string', title: 'Na' + ESC + 'me', description: 'a' + ESC + '[2Jb' },
      plan: { type: 'string', enum: ['fr' + ESC + 'ee', 'pro'] }
    }
  })
  t.is(f.title, 'Hi]0;pwn', 'title sanitized (no ESC/BEL)')
  t.is(f.description, 'desc', 'description sanitized')
  t.is(f.fields[0].label, 'Name', 'field label sanitized')
  t.is(f.fields[0].description, 'a[2Jb', 'field description sanitized')
  t.is(f.fields[1].control.options[0].label, 'free', 'enum option label sanitized')
  t.absent(f.view().includes(DEL), 'no raw DEL reaches the rendered view')
})

test('security: control chars in formData are stripped before they render', (t) => {
  const f = form.fromSchema(
    { type: 'object', properties: { name: { type: 'string' } } },
    { formData: { name: 'a' + ESC + ']0;x' + BEL + 'b' } }
  )
  t.is(f.value().name, 'a]0;xb', 'rehydrated value sanitized')
})

test('security: hardening follows the recursion into nested objects', (t) => {
  // A pollution key as a nested property name is still refused.
  const schema = JSON.parse(
    '{"type":"object","properties":{"a":{"type":"object","properties":{"__proto__":{"type":"string"}}}}}'
  )
  t.exception(() => form.fromSchema(schema), /not allowed/, 'nested __proto__ refused')

  // Control chars inside a nested formData value are stripped too.
  const f = form.fromSchema(
    {
      type: 'object',
      required: ['a'],
      properties: { a: { type: 'object', properties: { b: { type: 'string' } } } }
    },
    { formData: { a: { b: 'x' + ESC + ']0;y' + BEL } } }
  )
  t.is(f.value().a.b, 'x]0;y', 'nested rehydrated value sanitized')
})

test('security: hardening covers variant and conditional schemas', (t) => {
  // A control-charred branch title is sanitized before it becomes an option label.
  const v = form.fromSchema({
    type: 'object',
    properties: {
      x: {
        oneOf: [
          { title: 'Ca' + ESC + 'rd', properties: { n: { type: 'string' } } },
          { title: 'Cash', properties: { m: { type: 'string' } } }
        ]
      }
    }
  })
  t.is(v.fields[0].control.options[0].label, 'Card', 'branch title sanitized')

  // A pollution key as a branch property name is refused. (Built via JSON.parse
  // so __proto__ is a real own key, not the object-literal prototype setter.)
  t.exception(
    () =>
      form.fromSchema(
        JSON.parse(
          '{"type":"object","properties":{"x":{"oneOf":[' +
            '{"properties":{"__proto__":{"type":"string"}}},' +
            '{"properties":{"ok":{"type":"string"}}}]}}}'
        )
      ),
    /not allowed/,
    'branch __proto__ refused'
  )

  // A pollution key named in an `if` is refused.
  t.exception(
    () =>
      form.fromSchema(
        JSON.parse(
          '{"type":"object","properties":{"a":{"type":"string"}},' +
            '"if":{"properties":{"__proto__":{"const":"x"}}},"then":{"properties":{"b":{"type":"string"}}}}'
        )
      ),
    /not allowed/,
    'if-controller __proto__ refused'
  )
})

test('security: array rehydration is capped and item keys are checked', (t) => {
  // A huge formData array can't create unbounded entries.
  const schema = {
    type: 'object',
    properties: {
      xs: { type: 'array', items: { type: 'object', properties: { v: { type: 'string' } } } }
    }
  }
  const big = []
  for (let i = 0; i < 5000; i++) big.push({ v: 'x' })
  const f = form.fromSchema(schema, { formData: { xs: big }, limits: { maxArrayItems: 10 } })
  t.is(f.value().xs.length, 10, 'rehydrated entries capped at maxArrayItems')

  // A pollution key as an item property name is refused.
  t.exception(
    () =>
      form.fromSchema(
        JSON.parse(
          '{"type":"object","properties":{"xs":{"type":"array",' +
            '"items":{"type":"object","properties":{"__proto__":{"type":"string"}}}}}}'
        )
      ),
    /not allowed/,
    'item __proto__ refused'
  )
})

test('security: uiSchema strings are sanitized and its keys are pollution-safe', (t) => {
  // Control chars in ui:title / ui:help are stripped before they render.
  const f = form.fromSchema(
    { type: 'object', properties: { name: { type: 'string' } } },
    {
      uiSchema: {
        name: { 'ui:title': 'Na' + ESC + ']0;x' + BEL + 'me', 'ui:help': 'h' + DEL + 'i' }
      }
    }
  )
  const field = f.fields.find((x) => x.key === 'name')
  t.is(field.label, 'Na]0;xme', 'ui:title sanitized')
  t.is(field.help, 'hi', 'ui:help sanitized')

  // A __proto__ entry in ui:order can't inject a field (only known names order).
  const ordered = form.fromSchema(
    { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } } },
    { uiSchema: { 'ui:order': ['__proto__', 'b', 'a'] } }
  )
  t.alike(
    ordered.fields.map((x) => x.key),
    ['b', 'a'],
    'unknown/dangerous order names are ignored'
  )

  // A uiSchema keyed by __proto__ is not consulted as a real node.
  const safe = JSON.parse('{"type":"object","properties":{"a":{"type":"string"}}}')
  t.ok(
    form.fromSchema(safe, { uiSchema: JSON.parse('{"__proto__":{"ui:widget":"hidden"}}') }),
    'pollution-keyed uiSchema node is ignored, not applied'
  )
})

test('security: deeply nested formData is bounded, not a stack overflow', (t) => {
  // Build formData far deeper than any field; cleanData must bound its recursion.
  let deep = { leaf: 'x' }
  for (let i = 0; i < 5000; i++) deep = { nested: deep }
  const f = form.fromSchema(
    { type: 'object', properties: { a: { type: 'string' } } },
    { formData: deep }
  )
  t.ok(f, 'pathologically deep formData neither hangs nor throws')
})

test('security: a ReDoS-shaped pattern is dropped (not enforced) with a warning', (t) => {
  const f = form.fromSchema({
    type: 'object',
    properties: { s: { type: 'string', pattern: '(a+)+$' } }
  })
  const field = f.fields[0]
  field.setValue('anything-not-matching!')
  t.is(field.validate(), null, 'the dangerous pattern is not used as a check')
  t.ok(
    f.warnings.some((w) => w.includes('s') && w.includes('ReDoS')),
    'the drop is surfaced on form.warnings'
  )
})

test('security: { trusted: true } compiles patterns verbatim', (t) => {
  const f = form.fromSchema(
    { type: 'object', properties: { s: { type: 'string', pattern: '^[a-z]+$' } } },
    { trusted: true }
  )
  const field = f.fields[0]
  field.setValue('ABC')
  t.is(field.validate(), 'invalid format', 'pattern is enforced when trusted')
  field.setValue('abc')
  t.is(field.validate(), null, 'matching value passes')
  t.is(f.warnings.length, 0, 'nothing dropped')
})

test('security: an over-long or invalid pattern is dropped, never thrown', (t) => {
  const long = form.fromSchema({
    type: 'object',
    properties: { s: { type: 'string', pattern: 'a'.repeat(2000) } }
  })
  t.ok(
    long.warnings.some((w) => w.includes('longer than')),
    'over-length pattern dropped with a reason'
  )

  const bad = form.fromSchema({
    type: 'object',
    properties: { s: { type: 'string', pattern: '(' } }
  })
  t.ok(
    bad.warnings.some((w) => w.includes('valid')),
    'invalid regex dropped, not thrown'
  )
})

test('security: prototype-pollution property names are refused', (t) => {
  const schema = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}')
  t.exception(() => form.fromSchema(schema), /not allowed/, 'object property name refused')
  t.exception(
    () => form.fromSchema({ type: 'string' }, { name: 'constructor' }),
    /not allowed/,
    'primitive name refused'
  )
})

test('security: a pollution key in formData neither pollutes nor throws', (t) => {
  const before = {}.polluted
  const formData = JSON.parse('{"name":"ok","__proto__":{"polluted":true}}')
  const f = form.fromSchema(
    { type: 'object', properties: { name: { type: 'string' } } },
    { formData }
  )
  t.is(f.value().name, 'ok', 'real field still rehydrated')
  t.is({}.polluted, before, 'Object.prototype not polluted')
})

test('security: size caps reject oversized schemas (configurable)', (t) => {
  const many = { type: 'object', properties: {} }
  for (let i = 0; i < 5; i++) many.properties['f' + i] = { type: 'string' }
  t.exception(() => form.fromSchema(many, { limits: { maxFields: 3 } }), /over the limit/)

  const bigEnum = {
    type: 'object',
    properties: { c: { type: 'string', enum: ['a', 'b', 'c', 'd'] } }
  }
  t.exception(() => form.fromSchema(bigEnum, { limits: { maxEnum: 2 } }), /over the limit/)

  // Within limits it builds fine.
  t.ok(form.fromSchema(many, { limits: { maxFields: 10 } }), 'under the cap is fine')
})

test('security: maxLength is clamped to the string ceiling', (t) => {
  const f = form.fromSchema(
    { type: 'object', properties: { s: { type: 'string', maxLength: 1000 } } },
    { limits: { maxStringLength: 5 } }
  )
  const field = f.fields[0].focus()
  for (const c of 'abcdefghij') field.update(typed(c))
  t.is(field.value().length, 5, 'input capped at the clamped ceiling, not maxLength')
})

test('security: junk numeric constraints are ignored, not trusted', (t) => {
  const f = form.fromSchema(
    JSON.parse(
      '{"type":"object","properties":{' +
        '"s":{"type":"string","minLength":"evil"},' +
        '"n":{"type":"number","minimum":null,"maximum":"big"}}}'
    )
  )
  const [s, n] = f.fields
  s.setValue('x')
  t.is(s.validate(), null, 'non-numeric minLength ignored (no spurious error)')
  t.is(n.min, undefined, 'non-numeric minimum ignored')
  t.is(n.max, undefined, 'non-numeric maximum ignored')
})

test('security: NaN/Infinity defaults are sanitized to a usable field', (t) => {
  const f = form.fromSchema(
    JSON.parse('{"type":"object","properties":{"n":{"type":"number","default":null}}}')
  )
  t.is(f.value().n, null, 'no junk default leaks into value()')
})

test('security: harden.isSafeRegexSource flags the catastrophic family', (t) => {
  for (const bad of ['(a+)+$', '(a*)*', '(.*)*', '([a-z]+)*', '(a{1,}){1,}', '((ab)+)+']) {
    t.absent(harden.isSafeRegexSource(bad), bad + ' rejected')
  }
  for (const ok of ['^\\S+@\\S+$', '(ab)+', 'a{1,5}', '(a+){1,5}', '[A-Za-z0-9_]+']) {
    t.ok(harden.isSafeRegexSource(ok), ok + ' allowed')
  }
})
