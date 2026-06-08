// Structural field helpers for hand-built forms: nested object sections and
// repeatable arrays. These return the same plain definition objects that
// fromSchema emits (the form flattens them), so a hand-written form has the same
// structural vocabulary as a schema-built one — and you can mix field instances,
// leaf defs, and these freely in one `fields` array.
//
//   form.create({ fields: [
//     form.text({ name: 'name', autofocus: true }),
//     form.group({ name: 'address', title: 'Address', fields: [
//       form.text({ name: 'street' }), form.text({ name: 'city' })
//     ]}),
//     form.array({ name: 'tags', minItems: 1, removable: false, fields: [
//       { type: 'text', name: 'label' }   // item fields are DEFS (see below)
//     ]})
//   ]})
const { Field } = require('./fields/base')

// A nested object section. `optional: true` makes it a checkbox-gated section;
// otherwise it's an always-included subform. `fields` may be field instances or
// defs — a group is rendered once, so instances are fine here.
function group(opts = {}) {
  return {
    type: 'object',
    name: opts.name,
    title: opts.title || opts.name,
    description: opts.description || '',
    optional: !!opts.optional,
    fields: opts.fields || []
  }
}

// A repeatable object subform (add/remove entries). `fields` are the *template*
// for each entry, so they MUST be plain defs ({ type, name, … }), not field
// instances — every entry needs its own instance, and a shared instance would
// bleed values between rows. (fromSchema always passes defs; this guards the
// hand-built path with a clear error.)
function array(opts = {}) {
  const itemFields = opts.fields || opts.itemFields || []
  for (const it of itemFields) {
    if (it instanceof Field) {
      throw new Error(
        'form.array: item fields must be plain defs (e.g. { type: "text", name }), not field ' +
          'instances — each entry needs its own, so a shared instance would bleed values'
      )
    }
  }
  return {
    type: 'array',
    name: opts.name,
    title: opts.title || opts.name,
    description: opts.description || '',
    itemTitle: opts.itemTitle || 'Item',
    addLabel: opts.addLabel || '+ Add',
    itemFields,
    minItems: opts.minItems || 0,
    maxItems: opts.maxItems || 100,
    addable: opts.addable !== false,
    removable: opts.removable !== false
  }
}

module.exports = { group, array }
