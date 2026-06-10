// bare-tui-form — a declarative form builder for bare-tui.
//
// Built entirely on bare-tui's field controls (textinput, textarea, select,
// radio, checkbox) and its focus ring: this package adds the orchestration
// layer — labels, descriptions, per-field validation, focus movement, and
// submission — that a form needs but a control library deliberately leaves out.
//
//   const form = require('bare-tui-form')
//
//   const f = form.create({
//     title: 'Sign up',
//     fields: [
//       form.text({ name: 'name', label: 'Name', required: true }),
//       form.text({ name: 'email', label: 'Email', validate: isEmail }),
//       form.select({ name: 'plan', label: 'Plan', options: ['free', 'pro'] }),
//       form.confirm({ name: 'tos', label: 'Accept terms', required: true })
//     ]
//   })
//
//   const values = await form.run(f) // { name, email, plan, tos } | null
//
// Fields can also be plain `{ type, name, … }` objects, which is the shape a
// JSON-Schema mapper will produce — see the README for that planned path.
const { create, run, Form, fromDef } = require('./form')
const { fromSchema } = require('./schema')
const { defaultTheme, frame, frames } = require('./theme')

const { text, TextField } = require('./fields/text')
const { textarea, TextareaField } = require('./fields/textarea')
const { number, NumberField } = require('./fields/number')
const { select, SelectField } = require('./fields/select')
const { radio, RadioField } = require('./fields/radio')
const { confirm, ConfirmField } = require('./fields/confirm')
const { multiselect, MultiSelectField } = require('./fields/multiselect')
const { file, FileField } = require('./fields/file')
const { section, SectionToggleField } = require('./fields/section')
const { constant, ConstField } = require('./fields/constant')
const { action, ActionField } = require('./fields/action')
const { group, array } = require('./structural')
const { Field } = require('./fields/base')

module.exports = {
  // Form
  create, // form.create({ title, fields }) → Form
  run, // form.run(form, programOpts?) → Promise<values | null>
  Form,
  fromDef, // fromDef({ type, … }) → field instance (the schema-friendly hook)
  fromSchema, // fromSchema(jsonSchema, opts?) → Form built from a JSON Schema
  defaultTheme, // the default theme object, to spread/extend in form.create({ theme })
  frame, // form.frame({ border, color, background, padding, width }) → a theme.frame fn
  frames, // ready-made frame presets: frames.rounded / .normal / .thick / .double

  // Field factories
  text,
  textarea,
  number,
  select,
  radio,
  confirm,
  multiselect,
  file, // a type-or-browse path field (filepicker overlay); ui:widget 'file' / 'directory'
  section, // the optional-section gate (usually produced by fromSchema, not hand-written)
  constant, // a fixed value (JSON Schema const); usually produced by fromSchema
  action, // a focusable button (array add/remove); usually produced by fromSchema

  // Structural helpers for hand-built forms (nested objects, repeatable arrays)
  group, // form.group({ name, fields, optional }) → a nested object section
  array, // form.array({ name, fields, minItems, maxItems, addable, removable })

  // Classes (for extension / instanceof)
  Field,
  TextField,
  TextareaField,
  NumberField,
  SelectField,
  RadioField,
  ConfirmField,
  MultiSelectField,
  FileField,
  SectionToggleField,
  ConstField,
  ActionField
}
