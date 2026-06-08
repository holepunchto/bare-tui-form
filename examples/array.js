// Arrays of objects: a repeatable subform.
//
//   bare examples/array.js
//
// `invitees` is an array whose items are objects, so it renders as a list of
// entries you grow with "+ Add" and shrink with a per-entry "✕ Remove". Reach
// the buttons with tab and press enter on them; enter on a data field moves to
// the next one (and submits past the buttons at the end). The result is a real
// array of objects. minItems/maxItems bound the count, and each entry's required
// fields are validated.
const form = require('..')

const schema = {
  type: 'object',
  title: 'Send invites',
  properties: {
    event: { type: 'string', title: 'Event name', minLength: 2 },
    invitees: {
      type: 'array',
      title: 'Invitees',
      minItems: 1,
      maxItems: 5,
      items: {
        type: 'object',
        title: 'Invitee',
        required: ['name'],
        properties: {
          name: { type: 'string', title: 'Name' },
          email: { type: 'string', title: 'Email', format: 'email' },
          role: { type: 'string', title: 'Role', enum: ['guest', 'speaker', 'organizer'] }
        }
      }
    }
  }
}

// Pre-fill with one invitee to show rehydration sizing the array.
const formData = {
  event: 'Launch party',
  invitees: [{ name: 'Ada', email: 'ada@example.com', role: 'speaker' }]
}

async function main() {
  const values = await form.run(form.fromSchema(schema, { formData }))
  if (values === null) console.log('\nCancelled.')
  else console.log('\nResult:\n' + JSON.stringify(values, null, 2))
}

main()
