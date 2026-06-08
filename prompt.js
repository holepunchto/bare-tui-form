// prompt.js — embeddable instructions that teach an LLM to emit a JSON Schema
// (and, optionally, a uiSchema) that bare-tui-form can render into a terminal
// form and collect from a user.
//
// This is meant to be *imported into your app* and dropped into your model's
// system prompt — not read from this repo at runtime — so an embedded LLM can
// drive form collection dynamically:
//
//   const { build } = require('bare-tui-form/prompt')
//
//   const system = build()                       // flat fields only (smallest)
//   const system = build({ nesting: true })      // + objects/arrays/oneOf/if
//   const system = build({ uiSchema: true })     // + presentation, two outputs
//
// Then feed the model's JSON straight into fromSchema:
//
//   const { fromSchema } = require('bare-tui-form')
//   const f = fromSchema(JSON.parse(modelJson))  // (parse uiSchema too if used)
//
// It is written for *small* models, so the exported strings are terse. The
// layers are separate exports (CORE / NESTING / UI_SCHEMA) so you only spend
// tokens on what your forms actually use; build() assembles them plus the
// matching output contract. The verbose comments here are for you, the
// developer — they are not part of any exported string.
//
// SECURITY: every string the model produces is untrusted and fromSchema is
// hardened for exactly that (see harden.js / schema.js). The prompt does not
// relax those defenses; it only shapes what a cooperative model emits.

// What the form can do with a flat object schema — the 80% case.
const CORE = `You collect data from a person with a form. You describe the form as ONE JSON Schema object; it is rendered in a terminal and the answers come back as JSON matching it.

Rules:
- The schema root is {"type":"object","properties":{...}}. Each property is one field.
- Give each property a short "title" (the on-screen label). Add a one-line "description" only when it genuinely helps.
- Put mandatory property names in the root "required" array.
- "default" pre-fills a field.

Field type comes from the property's "type":
- "string" -> text box. Checks: "minLength", "maxLength", "pattern" (regex), "format":"email" or "uri".
- "integer"/"number" -> number box; "minimum"/"maximum" bound it.
- "boolean" -> a yes/no checkbox.
- "string" with "enum":[...] -> single-choice menu. Add "enumNames":[...] (same order) for nicer labels.

Stay minimal: only the properties you need, short titles, no filler.

Example -- "sign up: name, email, plan":
{"type":"object","title":"Sign up","required":["name","email"],"properties":{"name":{"type":"string","title":"Full name","minLength":1},"email":{"type":"string","title":"Email","format":"email"},"plan":{"type":"string","title":"Plan","enum":["free","pro"],"enumNames":["Free","Pro"],"default":"free"},"news":{"type":"boolean","title":"Email me updates"}}}`

// Structure: nested objects, repeatable/multi arrays, oneOf/anyOf, if/then/else.
// Append only when your forms need shape beyond a flat list.
const NESTING = `Structure (use only when the data needs it):
- Nested object: a property with "type":"object" and its own "properties" -> a sub-section. In the parent "required" it is always shown; otherwise it is optional and the user opts in with a checkbox.
- Pick many: "type":"array","items":{"enum":[...]} -> a multi-select list.
- Repeatable group: "type":"array","items":{"type":"object","properties":{...}} -> the user adds/removes entries; "minItems"/"maxItems" bound the count.
- One of several shapes: "oneOf" (or "anyOf") = a list of branches. Make them ALL scalar ({"const":x} or {"enum":[...]}) -> a value picker, OR ALL objects ({"properties":{...}}) -> the user picks a branch and fills it. Never mix the two.
- Conditional fields: "if":{"properties":{"kind":{"const":"card"}}},"then":{"properties":{...}},"else":{"properties":{...}} -> the then/else fields appear based on another field. "if" may only test "const" or "enum" on sibling properties.
- Fixed value: "const" on a property -> a non-editable value (useful as a oneOf branch tag).

Never emit (these are rejected): arrays of plain strings/numbers (use items.enum or object items), arrays inside arrays, "allOf", "$ref".`

// Presentation layer. Mirrors RJSF's uiSchema. Changes the OUTPUT CONTRACT:
// the model must now emit two objects. build({ uiSchema: true }) swaps in
// BOTH_OUTPUT to say so.
const UI_SCHEMA = `Presentation: you also emit a second object, a uiSchema, that mirrors the schema's property names. It controls looks only -- never put data or validation in it.

Per property (each "ui:KEY" may instead sit in "ui:options":{KEY:...} without the prefix):
- "ui:widget": "textarea" (multi-line; rows via "ui:options":{"rows":N}), "password" (masked), "radio" (show an enum as radio buttons), "hidden" (collected, not shown).
- "ui:help" (a hint line), "ui:placeholder", "ui:title"/"ui:description" (override the schema's), "ui:autofocus":true, "ui:readonly":true, "ui:options":{"label":false} (hide the label).
On the root: "ui:order":["a","b","*"] orders fields ("*" = everything else).
On a repeatable group: nest item presentation under "items"; lock the count with "ui:options":{"addable":false} or {"removable":false}.

Example pairing:
schema:   {"type":"object","properties":{"pw":{"type":"string","title":"Password"},"bio":{"type":"string","title":"Bio"}}}
uiSchema: {"ui:order":["pw","bio"],"pw":{"ui:widget":"password"},"bio":{"ui:widget":"textarea","ui:options":{"rows":4}}}`

const INTRO = `You design a terminal form to gather information from a user.`

// Output contracts — one of these closes the prompt so the model knows the
// exact shape to return.
const SCHEMA_OUTPUT = `Output: emit ONLY the JSON Schema object. No prose, no markdown, no code fence.`
const BOTH_OUTPUT = `Output: emit TWO JSON objects, the JSON Schema first and the uiSchema second, separated by a line containing only ---. No prose, no code fence.`

// Assemble a system prompt from the layers you want.
//   build()                      -> intro + CORE + schema-only output
//   build({ nesting: true })     -> + NESTING
//   build({ uiSchema: true })    -> + UI_SCHEMA + two-object output
// Pass { intro: false } to drop the framing line if you supply your own.
function build(opts = {}) {
  const parts = []
  if (opts.intro !== false) parts.push(INTRO)
  parts.push(CORE)
  if (opts.nesting) parts.push(NESTING)
  if (opts.uiSchema) parts.push(UI_SCHEMA)
  parts.push(opts.uiSchema ? BOTH_OUTPUT : SCHEMA_OUTPUT)
  return parts.join('\n\n')
}

module.exports = {
  build, // build({ nesting?, uiSchema?, intro? }) -> assembled system prompt
  CORE, // flat object schema: types, titles, required, enums, validation
  NESTING, // nested objects, arrays, oneOf/anyOf, if/then/else, const
  UI_SCHEMA, // uiSchema presentation layer (implies the two-object output)
  INTRO, // one-line framing sentence
  SCHEMA_OUTPUT, // output contract: schema only
  BOTH_OUTPUT // output contract: schema + uiSchema, --- separated
}
