// The same form, but defined entirely with plain { type, … } objects instead of
// the factory functions.
//
//   bare examples/from-objects.js
//
// This is the shape a JSON-Schema → form mapper will produce (see the README
// roadmap): the field list is pure data, so it can come from a config file, an
// API response, or an LLM's structured output rather than from code.
const form = require('..')

const definition = {
  title: 'New issue',
  fields: [
    { type: 'text', name: 'title', label: 'Title', required: true },
    { type: 'select', name: 'priority', label: 'Priority', options: ['low', 'medium', 'high'] },
    {
      type: 'multiselect',
      name: 'labels',
      label: 'Labels',
      description: 'space to toggle',
      options: ['bug', 'feature', 'docs']
    },
    { type: 'textarea', name: 'body', label: 'Description', description: 'tab to move on' },
    { type: 'confirm', name: 'notify', label: 'Notify watchers' }
  ]
}

async function main() {
  const values = await form.run(form.create(definition))
  if (values === null) console.log('\nCancelled.')
  else console.log('\nSubmitted:\n' + JSON.stringify(values, null, 2))
}

main()
