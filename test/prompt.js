// Tests for the embeddable LLM prompt. The strings are content, so we don't
// pin wording; we pin the layering contract (which sections appear, which
// output rule closes it) and — the part that actually matters — that the
// example schema the prompt teaches a model to emit really does parse through
// fromSchema. If we ever tighten the mapper, this catches a prompt that now
// teaches an unsupported shape.
const { test } = require('brittle')
const prompt = require('../prompt')
const { fromSchema } = require('..')

test('prompt: build() is core + schema-only output by default', (t) => {
  const p = prompt.build()
  t.ok(p.includes(prompt.INTRO), 'framing line included')
  t.ok(p.includes(prompt.CORE), 'core layer included')
  t.absent(p.includes(prompt.NESTING), 'nesting omitted by default')
  t.absent(p.includes(prompt.UI_SCHEMA), 'uiSchema omitted by default')
  t.ok(p.includes(prompt.SCHEMA_OUTPUT), 'schema-only output contract')
  t.absent(p.includes(prompt.BOTH_OUTPUT), 'not the two-object contract')
})

test('prompt: layers are opt-in and uiSchema switches the output contract', (t) => {
  const p = prompt.build({ nesting: true, uiSchema: true })
  t.ok(p.includes(prompt.NESTING), 'nesting layer added')
  t.ok(p.includes(prompt.UI_SCHEMA), 'uiSchema layer added')
  t.ok(p.includes(prompt.BOTH_OUTPUT), 'two-object output contract')
  t.absent(p.includes(prompt.SCHEMA_OUTPUT), 'schema-only contract dropped')
})

test('prompt: intro can be dropped', (t) => {
  t.absent(prompt.build({ intro: false }).includes(prompt.INTRO), 'no framing line')
})

// Pull the JSON object(s) out of an example block: any line whose tail (from
// its first `{`, so a "schema:"/"uiSchema:" label is dropped) parses as JSON.
// Illustrative braces in the prose ({...}, {KEY:...}) don't parse, so they're
// skipped — leaving just the real example objects, in order.
const jsonObjects = (s) => {
  const out = []
  for (const line of s.split('\n')) {
    const i = line.indexOf('{')
    if (i === -1) continue
    try {
      out.push(JSON.parse(line.slice(i)))
    } catch {
      continue
    }
  }
  return out
}

test('prompt: the CORE example schema renders without error', (t) => {
  const [schema] = jsonObjects(prompt.CORE)
  const f = fromSchema(schema)
  t.ok(f.fields.length >= 4, 'name, email, plan, news fields built')
  t.alike(f.warnings, [], 'no hardening warnings for a clean example')
})

test('prompt: the UI_SCHEMA example schema + uiSchema render together', (t) => {
  const [schema, ui] = jsonObjects(prompt.UI_SCHEMA)
  const f = fromSchema(schema, { uiSchema: ui })
  const [first] = f.fields
  t.is(first.name, 'pw', 'ui:order put password first')
  t.is(first.echoMode, 'password', 'ui:widget password applied')
})
