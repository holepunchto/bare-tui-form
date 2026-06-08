// Presentation with a uiSchema (react-jsonschema-form style).
//
//   bare examples/ui-schema.js
//
// The schema says *what* to collect; the uiSchema says *how* to present it —
// field order, which control (widget), labels/help/placeholders, autofocus,
// read-only, hidden fields, and array add/remove gating. A `widgets` registry
// lets you plug in custom field rendering by name (here: a "stars" rating).
const form = require('..')

const schema = {
  type: 'object',
  title: 'Submit a review',
  properties: {
    title: { type: 'string', minLength: 3 },
    rating: { type: 'integer' },
    body: { type: 'string' },
    visibility: { type: 'string', enum: ['public', 'private'] },
    password: { type: 'string' },
    source: { type: 'string', default: 'cli' }, // tracked, not shown
    tags: {
      type: 'array',
      items: { type: 'object', properties: { label: { type: 'string' } } }
    }
  }
}

const uiSchema = {
  // Put the most important fields first; '*' is everything else.
  'ui:order': ['title', 'rating', 'body', '*'],
  title: { 'ui:autofocus': true, 'ui:placeholder': 'A short headline' },
  rating: { 'ui:widget': 'stars' }, // custom widget from the registry below
  body: { 'ui:widget': 'textarea', 'ui:options': { rows: 6 }, 'ui:help': 'Markdown is fine' },
  visibility: { 'ui:widget': 'radio' },
  password: { 'ui:widget': 'password', 'ui:title': 'Edit PIN' },
  source: { 'ui:widget': 'hidden' }, // collected, never shown
  tags: { 'ui:options': { removable: false } } // can add, can't remove
}

// Custom widgets: name → a function returning a field definition.
const widgets = {
  stars: ({ name, label }) => ({
    type: 'select',
    name,
    label: label || 'Rating',
    options: [1, 2, 3, 4, 5].map((n) => ({ label: '★'.repeat(n) + '☆'.repeat(5 - n), value: n })),
    selected: 4
  })
}

async function main() {
  const values = await form.run(form.fromSchema(schema, { uiSchema, widgets }))
  if (values === null) console.log('\nCancelled.')
  else console.log('\nResult:\n' + JSON.stringify(values, null, 2))
}

main()
