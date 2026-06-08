// Validating dirty async fields on submit, behind one global spinner.
//
//   bare examples/async-submit.js
//
// Three fields have async validators (mock API calls). You can fill the form
// without confirming each field — when you press the submit key (ctrl+s), the
// form runs any async checks that haven't run yet, one at a time, showing a
// single "validating… k/n" spinner in the footer. The first failure stops the
// run and focuses that field; if they all pass, the form submits.
//
// This is on by default. Pass `validateAsyncOnSubmit: false` to opt out — then
// it's on you to make sure those checks ran (see the commented line below).
const { style } = require('bare-tui')
const form = require('..')

// Mock "API calls" with varying latency. Each resolves to an error string or null.
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function checkUsername(v) {
  await wait(700)
  return ['admin', 'root'].includes(v.toLowerCase()) ? `"${v}" is taken` : null
}
async function checkPromo(v) {
  await wait(500)
  return v && v.toUpperCase() !== 'LAUNCH' ? 'invalid promo code' : null
}
async function checkEmail(v) {
  await wait(600)
  return v.includes('@') ? null : 'that email looks wrong'
}

async function main() {
  const f = form.create({
    title: 'Create account',
    description: 'Fill it in, then press ctrl+s — the async checks run on submit',
    // validateAsyncOnSubmit: false,  // ← opt out; then YOU must run these checks
    theme: {
      title: (s) => style().bold(true).foreground('cyan').render(s),
      validating: (s) => style().foreground('cyan').render(s),
      spinner: { frames: 'line', fps: 12 }
    },
    fields: [
      // Pass the async functions directly — the form detects an async validator
      // and handles the spinner/queueing itself.
      form.text({
        name: 'username',
        label: 'Username',
        required: true,
        validatingMessage: 'checking availability…',
        validate: checkUsername
      }),
      form.text({ name: 'email', label: 'Email', required: true, validate: checkEmail }),
      form.text({ name: 'promo', label: 'Promo code (try LAUNCH)', validate: checkPromo })
    ]
  })

  const values = await form.run(f)
  if (values === null) console.log('\nCancelled.')
  else console.log('\nCreated:\n' + JSON.stringify(values, null, 2))
}

main()
