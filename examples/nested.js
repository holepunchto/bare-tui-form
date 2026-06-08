// Nested objects: subforms and optional sections.
//
//   bare examples/nested.js
//
// A nested `type: 'object'` becomes a sub-section. A *required* one (shipping)
// is an always-included subform. A *non-required* one (billing, gift) is an
// optional section gated by a checkbox: it auto-checks as soon as you type a
// field inside it, and toggling it off drops the whole subtree from the result.
// Tab into a gate and press space to toggle it by hand. The collected value is
// nested to match the schema.
const form = require('..')

const schema = {
  type: 'object',
  title: 'Checkout',
  description: 'Shipping is required; billing and gift options are up to you',
  required: ['email', 'shipping'],
  properties: {
    email: { type: 'string', title: 'Email', format: 'email' },
    shipping: {
      type: 'object',
      title: 'Shipping address',
      required: ['street', 'city'],
      properties: {
        street: { type: 'string', title: 'Street' },
        city: { type: 'string', title: 'City' },
        country: { type: 'string', title: 'Country', enum: ['US', 'CA', 'UK', 'PT'] }
      }
    },
    billing: {
      // optional: a checkbox gate. Its own `required` fields only bite once armed.
      type: 'object',
      title: 'Billing address (if different)',
      required: ['street', 'city'],
      properties: {
        street: { type: 'string', title: 'Street' },
        city: { type: 'string', title: 'City' }
      }
    },
    gift: {
      // optional: arm it and add a short message.
      type: 'object',
      title: 'Send as a gift',
      properties: {
        message: { type: 'string', title: 'Gift message' }
      }
    }
  }
}

// You can also pre-fill it — formData arms the gate of any section it includes.
const formData = {
  email: 'ada@example.com',
  shipping: { street: '12 King St', city: 'Lisbon', country: 'PT' }
}

async function main() {
  const f = form.fromSchema(schema, { formData })
  const values = await form.run(f)
  if (values === null) console.log('\nCancelled.')
  else console.log('\nResult:\n' + JSON.stringify(values, null, 2))
}

main()
