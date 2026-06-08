// schema — build a form from a JSON Schema.
//
// This is a thin mapping layer: it turns a JSON Schema into the same plain
// { type, name, … } field definitions that form.create already understands (via
// fromDef), so the form engine itself is untouched. The goal is to track a
// useful subset of what react-jsonschema-form supports, starting reasonable:
//
//   object schema            → a form, one field per property
//   nested object            → a sub-section: a required object is an always-
//                              included subform; an optional one is gated by a
//                              checkbox the user toggles (see form.js flatten)
//   oneOf / anyOf            → a variant selector (object branches) or, when the
//                              branches are all const/enum scalars, a plain select
//   if / then / else         → conditional fields that go live based on a guard
//                              over sibling controllers (the discriminator pattern)
//   const                    → a fixed, non-interactive value (e.g. a discriminator)
//   string / number /        → text / number / confirm fields
//     integer / boolean
//   enum                     → select (single choice)
//   array + items.enum       → multiselect (choose many)
//   array + items: object    → a repeatable subform the user grows/shrinks
//     (minItems / maxItems)     (each entry is the item object's fields)
//   required[]               → required fields
//   title / description      → labels and help text (form- and field-level)
//   default                  → initial values
//   enumNames                → option labels
//   minLength / maxLength /  → string validation (maxLength caps input)
//     pattern / format
//   minimum / maximum        → number bounds
//
// Not yet: arrays of primitives or free-form items, nested arrays, allOf (schema
// merge), $ref. Unsupported shapes throw a clear error rather than silently
// producing the wrong form.
//
// SECURITY: a JSON Schema is frequently untrusted input — produced by an LLM or
// received from a peer — and this function is the boundary where it becomes
// regexes and terminal output. So it's hardened (see harden.js): strings are
// stripped of terminal-control characters, `pattern` regexes are screened for
// ReDoS and bounded, dangerous property names are refused, numeric constraints
// are validated, and sizes are capped. The posture is secure-by-default; a
// caller who trusts the source passes { trusted: true } and/or { limits } to
// relax it, and anything dropped is surfaced on the returned form's `warnings`.
const { create } = require('./form')
const harden = require('./harden')

// format → validator. Extend as needed.
const FORMATS = {
  email: (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : 'must be a valid email'),
  uri: (v) => (/^[a-zA-Z][\w+.-]*:\/\/\S+$/.test(v) ? null : 'must be a valid URI')
}

// Build a Form from a JSON Schema. An object schema becomes a multi-field form;
// a primitive schema becomes a single-field form (keyed by opts.name or 'value').
//
// Pass opts.formData to rehydrate existing values (like react-jsonschema-form's
// formData). It overrides schema `default`s; properties it omits keep their
// default. For a single primitive schema, formData is the scalar itself.
//
// opts.trusted (default false): when true, regex `pattern`s are compiled as-is
// rather than screened for ReDoS. opts.limits overrides the size caps. Anything
// the hardening drops or clamps is reported on the returned form's `warnings`.
//
// opts.uiSchema: a react-jsonschema-form-style uiSchema (a parallel tree keyed
// by property name) for presentation — see applyUiPresentation/applyWidget for
// the supported subset. opts.widgets: a { name → fieldDefFactory } registry that
// ui:widget can select for custom field rendering. uiSchema strings are
// untrusted and pass through cleanText like everything else.
function fromSchema(schema, opts = {}) {
  if (!schema || typeof schema !== 'object') {
    throw new Error('fromSchema: schema must be a JSON Schema object')
  }

  const ui = opts.uiSchema || {}
  const ctx = {
    limits: { ...harden.DEFAULT_LIMITS, ...(opts.limits || {}) },
    trusted: opts.trusted === true,
    warnings: [],
    fieldCount: 0, // total leaf fields built so far (bounded by limits.maxFields)
    widgets: opts.widgets || {} // custom ui:widget name → field-def factory
  }

  let f
  if (typeOf(schema) === 'object' || schema.properties) {
    f = create({
      title: harden.cleanText(schema.title || opts.title || '', ctx.limits.maxTextLength),
      description: harden.cleanText(schema.description || '', ctx.limits.maxTextLength),
      theme: opts.theme,
      fields: fieldsFromObject(schema, ctx, 0, ui)
    })
    if (opts.formData) f.setValues(cleanData(opts.formData, ctx, 0))
  } else {
    const name = opts.name || 'value'
    harden.assertSafeKey(name)
    f = create({
      title: harden.cleanText(opts.title || '', ctx.limits.maxTextLength),
      theme: opts.theme,
      fields: [fieldFromProperty(name, schema, false, ctx, 0, ui)]
    })
    if (opts.formData !== undefined) {
      f.setValues({ [name]: cleanScalar(opts.formData, ctx, 0) })
    }
  }

  f.warnings = ctx.warnings
  return f
}

// The field definitions for an object schema's properties (in uiSchema `ui:order`
// if given, else insertion order), plus any if/then/else as a trailing
// conditional def. `depth` is the object-nesting level (for the recursion cap);
// `ui` is the uiSchema node for this object.
function fieldsFromObject(schema, ctx, depth, ui = {}) {
  const props = schema.properties || {}
  const required = new Set(schema.required || [])
  const names = orderNames(Object.keys(props), ui['ui:order'])
  const defs = names.map((name) => {
    harden.assertSafeKey(name)
    return fieldFromProperty(name, props[name], required.has(name), ctx, depth, childUi(ui, name))
  })
  const cond = conditionalDef(schema, ctx, depth, ui)
  if (cond) defs.push(cond)
  return defs
}

// Reorder property names per a uiSchema `ui:order` array. Only names that exist
// are honored (so it can't inject keys); '*' expands to the remaining names in
// their original order. A non-array order leaves the order untouched.
function orderNames(names, order) {
  if (!Array.isArray(order)) return names
  const set = new Set(names)
  const rest = names.filter((n) => !order.includes(n))
  if (order.includes('*')) {
    const out = []
    for (const n of order) {
      if (n === '*') out.push(...rest)
      else if (set.has(n)) out.push(n)
    }
    return out
  }
  return [...order.filter((n) => set.has(n)), ...rest]
}

// The uiSchema node for a child property (an object, never the prototype).
function childUi(ui, name) {
  if (!ui || harden.FORBIDDEN_KEYS.has(name)) return {}
  const node = ui[name]
  return node && typeof node === 'object' ? node : {}
}

// Read a uiSchema option, honoring both forms RJSF allows:
//   { 'ui:widget': 'x' }  ≡  { 'ui:options': { widget: 'x' } }
function uiGet(ui, key) {
  if (!ui) return undefined
  const direct = ui['ui:' + key]
  if (direct !== undefined) return direct
  const opts = ui['ui:options']
  return opts && typeof opts === 'object' ? opts[key] : undefined
}

// Apply the presentation-only uiSchema options to a finished leaf def.
function applyUiPresentation(def, ui, ctx) {
  const max = ctx.limits.maxTextLength
  const help = uiGet(ui, 'help')
  if (typeof help === 'string') def.help = harden.cleanText(help, max)
  const placeholder = uiGet(ui, 'placeholder')
  if (typeof placeholder === 'string') def.placeholder = harden.cleanText(placeholder, max)
  if (uiGet(ui, 'label') === false) def.hideLabel = true
  if (uiGet(ui, 'autofocus')) def.autofocus = true
  if (uiGet(ui, 'readonly') || uiGet(ui, 'disabled')) def.readonly = true
  if (def.type === 'text' && uiGet(ui, 'inputType') === 'password') def.echoMode = 'password'
  return def
}

// Apply a ui:widget override to a leaf def: switch the control (textarea,
// password, radio, hidden), defer to a registered custom widget, or warn and
// keep the default. Built-in names that already match our default (select,
// checkbox, checkboxes, updown, range) are no-ops.
function applyWidget(def, ui, ctx, name, prop) {
  const widget = uiGet(ui, 'widget')
  if (widget === undefined || widget === null || widget === '') return def
  if (typeof widget !== 'string') {
    ctx.warnings.push(`"${name}": ui:widget must be a string`)
    return def
  }
  switch (widget) {
    case 'hidden':
      def.hidden = true
      return def
    case 'textarea': {
      if (def.type !== 'text') return widgetMismatch(def, ctx, name, widget, 'string')
      def.type = 'textarea'
      const rows = harden.safeNumber(uiGet(ui, 'rows'))
      if (rows) def.height = Math.min(rows, 100)
      return def
    }
    case 'password':
      if (def.type !== 'text') return widgetMismatch(def, ctx, name, widget, 'string')
      def.echoMode = 'password'
      return def
    case 'radio':
      if (def.type !== 'select') return widgetMismatch(def, ctx, name, widget, 'enum')
      def.type = 'radio' // radio takes the same options/selected as select
      return def
    case 'select':
    case 'checkbox':
    case 'checkboxes':
    case 'updown':
    case 'range':
      return def // already our default control for that type
    default: {
      const factory = ctx.widgets[widget]
      if (typeof factory === 'function') {
        const custom = factory({
          name,
          label: def.label,
          description: def.description,
          required: def.required,
          value: def.value,
          schema: prop
        })
        if (custom && typeof custom === 'object') {
          if (!custom.name) custom.name = name
          return custom
        }
        ctx.warnings.push(`"${name}": custom widget "${widget}" returned no field def`)
        return def
      }
      ctx.warnings.push(`"${name}": unknown ui:widget "${widget}" (using the default)`)
      return def
    }
  }
}

function widgetMismatch(def, ctx, name, widget, expected) {
  ctx.warnings.push(`"${name}": ui:widget "${widget}" needs a ${expected} field (ignored)`)
  return def
}

// Count a leaf field against the global cap (throws when exceeded).
function countLeaf(ctx) {
  if (++ctx.fieldCount > ctx.limits.maxFields) {
    throw new Error(`fromSchema: more than ${ctx.limits.maxFields} fields (over the limit)`)
  }
}

function assertDepth(name, ctx, depth) {
  if (depth + 1 > ctx.limits.maxDepth) {
    throw new Error(
      `fromSchema: "${name}" nests deeper than the limit of ${ctx.limits.maxDepth} levels`
    )
  }
}

// Map one property schema to a field definition. Objects, oneOf/anyOf variants,
// and conditionals recurse into groups; everything else is a leaf field counted
// against the global cap. `ui` is the uiSchema node for this property.
function fieldFromProperty(name, prop, required, ctx, depth, ui = {}) {
  if (!prop || typeof prop !== 'object') {
    throw new Error(`fromSchema: property "${name}" must be a schema object`)
  }
  const max = ctx.limits.maxTextLength
  // uiSchema ui:title / ui:description override the schema's own.
  const uiTitle = uiGet(ui, 'title')
  const uiDesc = uiGet(ui, 'description')
  const base = {
    name,
    label: harden.cleanText(typeof uiTitle === 'string' ? uiTitle : prop.title || name, max),
    description: harden.cleanText(
      typeof uiDesc === 'string' ? uiDesc : prop.description || '',
      max
    ),
    required
  }
  // Presentation applied to whatever leaf def we end up with.
  const leaf = (def) => applyUiPresentation(applyWidget(def, ui, ctx, name, prop), ui, ctx)

  // const → a fixed, non-interactive value (e.g. a oneOf branch discriminator).
  if (prop.const !== undefined) {
    countLeaf(ctx)
    const value = typeof prop.const === 'string' ? harden.cleanText(prop.const, max) : prop.const
    return leaf({ name, label: base.label, description: base.description, type: 'constant', value })
  }

  // oneOf/anyOf → a selector. All-scalar branches collapse to a plain select;
  // object branches become a variant whose chosen branch's fields go live.
  const branches = prop.oneOf || prop.anyOf
  if (Array.isArray(branches)) return variantOrSelect(name, base, branches, prop, ctx, depth)

  // array → a multiselect (items.enum) or a repeatable object subform (items is
  // an object). Handled before the leaf count: a multiselect is one leaf, but an
  // array-of-objects' leaves are counted inside its itemFields.
  if (typeOf(prop) === 'array' && !Array.isArray(prop.enum)) {
    return arrayProperty(name, base, prop, ctx, depth, ui)
  }

  // Nested object → a sub-section (recurse). A non-required object becomes an
  // optional section the user gates with a checkbox; a required one is an
  // always-included subform. `enum` short-circuits below to a leaf select even
  // when the declared type is 'object', so guard against that here.
  if (typeOf(prop) === 'object' && !Array.isArray(prop.enum)) {
    assertDepth(name, ctx, depth)
    return {
      name,
      type: 'object',
      title: base.label,
      description: base.description,
      optional: !required,
      fields: fieldsFromObject(prop, ctx, depth + 1, ui)
    }
  }

  // From here on it's a leaf field — count it against the global cap.
  countLeaf(ctx)

  // enum → a single-choice select, regardless of the underlying type.
  if (Array.isArray(prop.enum)) {
    const selected = prop.default !== undefined ? prop.enum.indexOf(prop.default) : -1
    return leaf({
      ...base,
      type: 'select',
      options: optionsFromEnum(prop.enum, prop.enumNames, ctx, name),
      selected
    })
  }

  switch (typeOf(prop)) {
    case 'string':
      return leaf({
        ...base,
        type: 'text',
        value: harden.cleanText(prop.default ?? '', max),
        charLimit: charLimitFor(prop, ctx),
        validate: stringValidator(prop, ctx, name)
      })
    case 'number':
    case 'integer':
      return leaf({
        ...base,
        type: 'number',
        value: harden.safeNumber(prop.default),
        min: harden.safeNumber(prop.minimum),
        max: harden.safeNumber(prop.maximum),
        integer: typeOf(prop) === 'integer'
      })
    case 'boolean':
      // A checkbox always carries a value, so `required` (which would force
      // `true`) is dropped — matching JSON Schema, where false is valid.
      return leaf({
        name,
        label: base.label,
        description: base.description,
        type: 'confirm',
        value: !!prop.default
      })
    default:
      // Untyped/unknown → a plain text field.
      return leaf({ ...base, type: 'text', value: harden.cleanText(prop.default ?? '', max) })
  }
}

// oneOf/anyOf. Branches that are all scalars (const/enum, no properties) collapse
// to a plain single-choice select; branches that are all objects become a
// variant whose selected branch's fields go live. Mixed branches are refused.
// (anyOf is rendered the same as oneOf — pick one — which matches RJSF's UI.)
function variantOrSelect(name, base, branches, prop, ctx, depth) {
  if (branches.length > ctx.limits.maxBranches) {
    throw new Error(
      `fromSchema: "${name}" has ${branches.length} branches, over the limit of ${ctx.limits.maxBranches}`
    )
  }
  const scalar = (b) => b && typeof b === 'object' && !b.properties && isScalarBranch(b)
  const object = (b) => b && typeof b === 'object' && !!b.properties

  if (branches.every(scalar)) {
    countLeaf(ctx)
    const values = branches.map(scalarValue)
    const selected = prop.default !== undefined ? values.indexOf(prop.default) : -1
    return {
      ...base,
      type: 'select',
      options: branches.map((b, i) => ({
        label: harden.cleanText(String(b.title ?? values[i]), ctx.limits.maxTextLength),
        value: values[i]
      })),
      selected
    }
  }

  if (branches.every(object)) {
    assertDepth(name, ctx, depth)
    return {
      name,
      type: 'variant',
      title: base.label,
      description: base.description,
      selectorLabel: base.label,
      branches: branches.map((b, i) => ({
        id: i,
        title: harden.cleanText(b.title || `Option ${i + 1}`, ctx.limits.maxTextLength),
        fields: fieldsFromObject(b, ctx, depth + 1)
      }))
    }
  }

  throw new Error(
    `fromSchema: "${name}" oneOf/anyOf must be all object branches or all const/enum scalars`
  )
}

function isScalarBranch(b) {
  return b.const !== undefined || Array.isArray(b.enum)
}

function scalarValue(b) {
  if (b.const !== undefined) return b.const
  return Array.isArray(b.enum) ? b.enum[0] : undefined
}

// if/then/else on an object → a conditional def whose then/else fields go live
// based on a guard over sibling controllers. Supported `if` shape (the common
// discriminator): { properties: { <name>: { const } | { enum: [...] } } }. The
// guard matches when every named property holds one of its allowed values.
function conditionalDef(schema, ctx, depth, ui = {}) {
  if (!schema.if || (!schema.then && !schema.else)) return null
  const ifProps = (schema.if && schema.if.properties) || {}
  const when = Object.keys(ifProps).map((propName) => {
    harden.assertSafeKey(propName)
    const cond = ifProps[propName] || {}
    const allowed =
      cond.const !== undefined ? [cond.const] : Array.isArray(cond.enum) ? cond.enum : []
    return { name: propName, allowed: new Set(allowed) }
  })
  if (when.length === 0) return null
  return {
    type: 'conditional',
    when,
    then: schema.then ? fieldsFromObject(withoutNested(schema.then), ctx, depth, ui) : [],
    else: schema.else ? fieldsFromObject(withoutNested(schema.else), ctx, depth, ui) : []
  }
}

// then/else subschemas contribute their `properties` (and `required`) at the
// same object level; only those two keys are read here.
function withoutNested(sub) {
  return { properties: sub.properties || {}, required: sub.required || [] }
}

// array → multiselect (items.enum) or a repeatable object subform (items is an
// object). Other array shapes (primitive items, nested arrays) are refused.
// `ui` supplies item presentation (ui.items) and add/remove gating.
function arrayProperty(name, base, prop, ctx, depth, ui = {}) {
  const items = prop.items || {}

  if (Array.isArray(items.enum)) {
    countLeaf(ctx)
    const def = Array.isArray(prop.default) ? prop.default.slice(0, ctx.limits.maxEnum) : []
    return {
      ...base,
      type: 'multiselect',
      options: optionsFromEnum(items.enum, items.enumNames, ctx, name),
      value: def.map((v) => cleanScalar(v, ctx, 0))
    }
  }

  if (items && typeof items === 'object' && (items.properties || typeOf(items) === 'object')) {
    if (ctx.inArray) {
      throw new Error(`fromSchema: nested arrays ("${name}") are not supported yet`)
    }
    assertDepth(name, ctx, depth)
    ctx.inArray = true
    const itemFields = fieldsFromObject(items, ctx, depth + 1, childUi(ui, 'items'))
    ctx.inArray = false
    const cap = ctx.limits.maxArrayItems
    const maxItems = Math.min(harden.safeNumber(prop.maxItems) ?? cap, cap)
    const minItems = Math.min(Math.max(harden.safeNumber(prop.minItems) ?? 0, 0), maxItems)
    return {
      name,
      type: 'array',
      title: base.label,
      description: base.description,
      itemTitle: harden.cleanText(items.title || 'Item', ctx.limits.maxTextLength),
      addLabel: '+ Add',
      itemFields,
      minItems,
      maxItems,
      addable: uiGet(ui, 'addable') !== false,
      removable: uiGet(ui, 'removable') !== false
    }
  }

  throw new Error(
    `fromSchema: array "${name}" needs items.enum or object items (other arrays are not supported yet)`
  )
}

function optionsFromEnum(values, names, ctx, name) {
  if (values.length > ctx.limits.maxEnum) {
    throw new Error(
      `fromSchema: enum on "${name}" has ${values.length} entries, over the limit of ${ctx.limits.maxEnum}`
    )
  }
  return values.map((value, i) => ({
    label: harden.cleanText(
      String(names && names[i] !== undefined ? names[i] : value),
      ctx.limits.maxTextLength
    ),
    value // the value is returned as data, not rendered, so it's left intact
  }))
}

// Cap a text field's input length. An explicit, finite maxLength wins (clamped
// to the ceiling); otherwise unbounded (0) — the renderer/validators are still
// safe because pattern testing is itself length-bounded.
function charLimitFor(prop, ctx) {
  const n = harden.safeNumber(prop.maxLength)
  if (n === undefined || n <= 0) return 0
  return Math.min(n, ctx.limits.maxStringLength)
}

// Combine the string constraints into one sync validator (or undefined).
function stringValidator(prop, ctx, name) {
  const checks = []

  const minLength = harden.safeNumber(prop.minLength)
  if (minLength !== undefined) {
    checks.push((v) =>
      v.length >= minLength
        ? null
        : `must be at least ${minLength} character${minLength === 1 ? '' : 's'}`
    )
  }

  if (prop.pattern !== undefined) {
    const compiled = harden.compilePattern(prop.pattern, ctx)
    if (compiled.test) {
      checks.push((v) => (compiled.test(v) ? null : 'invalid format'))
    } else {
      ctx.warnings.push(`"${name}": ${compiled.reason}`)
    }
  }

  if (prop.format && FORMATS[prop.format]) checks.push(FORMATS[prop.format])

  if (checks.length === 0) return undefined
  return (v) => {
    for (const check of checks) {
      const err = check(v)
      if (err) return err
    }
    return null
  }
}

// Sanitize an untrusted rehydration value: strip control chars from strings (and
// from string elements of arrays), recurse into nested-section objects, and
// leave numbers/booleans/null as-is. Array length and recursion depth are both
// bounded so a huge or deeply-nested formData can't exhaust memory or the stack.
function cleanData(formData, ctx, depth) {
  if (!formData || typeof formData !== 'object') return formData
  if (depth > ctx.limits.maxDepth) return {} // too deep to match any field anyway
  const out = {}
  for (const key of Object.keys(formData)) {
    if (harden.FORBIDDEN_KEYS.has(key)) continue // never carry a pollution key through
    out[key] = cleanScalar(formData[key], ctx, depth + 1)
  }
  return out
}

function cleanScalar(v, ctx, depth) {
  if (typeof v === 'string') return harden.cleanText(v, ctx.limits.maxTextLength)
  if (Array.isArray(v)) {
    return v.slice(0, ctx.limits.maxEnum).map((x) => cleanScalar(x, ctx, depth))
  }
  if (v && typeof v === 'object') return cleanData(v, ctx, depth) // nested section
  return v
}

// JSON Schema allows `type` to be an array (e.g. ['string','null']); pick the
// first meaningful one.
function typeOf(schema) {
  const t = schema.type
  if (Array.isArray(t)) return t.find((x) => x !== 'null')
  return t
}

module.exports = { fromSchema, fieldsFromObject, fieldFromProperty }
