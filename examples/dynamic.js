// Dynamic forms: oneOf/anyOf variants and if/then/else conditionals.
//
//   bare examples/dynamic.js
//
// The set of fields changes as you type. The "Payment method" selector swaps in
// the chosen branch's fields (a oneOf variant); the "Country" choice reveals a
// ZIP or a postcode (if/then/else). Hidden fields aren't focusable, collected,
// or validated — tab only visits what's live, and the result nests to match.
const form = require('..')

const schema = {
  type: 'object',
  title: 'Order',
  required: ['country', 'payment'],
  properties: {
    country: { type: 'string', title: 'Country', enum: ['US', 'UK'] },
    payment: {
      title: 'Payment method',
      oneOf: [
        {
          title: 'Credit card',
          properties: {
            kind: { const: 'card' },
            number: { type: 'string', title: 'Card number' },
            cvv: { type: 'string', title: 'CVV' }
          },
          required: ['number', 'cvv']
        },
        {
          title: 'PayPal',
          properties: {
            kind: { const: 'paypal' },
            email: { type: 'string', title: 'PayPal email', format: 'email' }
          },
          required: ['email']
        }
      ]
    }
  },
  // Reveal a different address field based on the country.
  if: { properties: { country: { const: 'US' } } },
  then: { properties: { zip: { type: 'string', title: 'ZIP code' } }, required: ['zip'] },
  else: { properties: { postcode: { type: 'string', title: 'Postcode' } } }
}

async function main() {
  const values = await form.run(form.fromSchema(schema))
  if (values === null) console.log('\nCancelled.')
  else console.log('\nResult:\n' + JSON.stringify(values, null, 2))
}

main()
