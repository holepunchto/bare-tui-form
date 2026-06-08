// Build a form from a JSON Schema.
//
//   bare examples/schema.js
//
// fromSchema(schema) maps a JSON Schema to a working form — the path that lets
// an LLM describe the questions it needs answered as a schema and get a real
// terminal form, with the answers coming back as a matching JSON object.
const form = require('..')

const schema = {
  type: 'object',
  title: 'New project',
  description: 'Answer a few questions to scaffold it',
  required: ['name', 'license'],
  properties: {
    name: {
      type: 'string',
      title: 'Project name',
      minLength: 2
    },
    description: {
      type: 'string',
      title: 'Description'
    },
    license: {
      type: 'string',
      title: 'License',
      enum: ['MIT', 'Apache-2.0', 'GPL-3.0', 'none'],
      enumNames: ['MIT', 'Apache 2.0', 'GPL v3', 'No license']
    },
    private: {
      type: 'boolean',
      title: 'Private repository',
      default: false
    },
    features: {
      type: 'array',
      title: 'Features',
      description: 'space to toggle',
      items: { enum: ['tests', 'ci', 'docs', 'linting'] },
      default: ['tests']
    },
    teamSize: {
      type: 'integer',
      title: 'Team size',
      minimum: 1,
      maximum: 50,
      default: 1
    }
  }
}

async function main() {
  const values = await form.run(form.fromSchema(schema))
  if (values === null) console.log('\nCancelled.')
  else console.log('\nResult:\n' + JSON.stringify(values, null, 2))
}

main()
