// A styled form with a long-running async validation.
//
//   bare examples/async-validation.js
//
// The username field's `validate` is an async function that mimics an API call
// (an 800ms availability check). Because it's async, the form automatically
// shows a spinner + message while it runs, gates input until it settles, then
// either shows the error or advances — you don't wire any of that up yourself.
//
// It also passes a custom `theme` to restyle the form chrome (title, labels,
// errors, spinner).
const { style } = require('bare-tui')
const form = require('..')

// A mock "API call": resolves after ~800ms. 'admin' and 'root' are taken.
const taken = new Set(['admin', 'root'])
function checkUsername(name) {
  return new Promise((resolve) => setTimeout(() => resolve(!taken.has(name.toLowerCase())), 800))
}

async function main() {
  const f = form.create({
    title: 'Reserve a username',
    theme: {
      title: (s) => style().bold(true).foreground('magenta').render(s),
      labelFocused: (s) => style().bold(true).foreground('cyan').render(s),
      error: (s) => style().foreground('yellow').render(s),
      validating: (s) => style().foreground('magenta').render(s),
      spinner: { frames: 'line', fps: 12 }
    },
    fields: [
      form.text({
        name: 'username',
        label: 'Username',
        required: true,
        validatingMessage: 'checking availability…',
        // Just make validate async — that's all it takes to get the spinner.
        validate: async (value) => {
          const available = await checkUsername(value)
          return available ? null : `"${value}" is taken, try another`
        }
      }),
      form.text({
        name: 'displayName',
        label: 'Display name',
        validate: (v) => (v.length <= 30 ? null : 'keep it under 30 characters')
      }),
      form.confirm({ name: 'tos', label: 'Accept the terms', required: true })
    ]
  })

  const values = await form.run(f)
  if (values === null) console.log('\nCancelled.')
  else console.log('\nReserved:\n' + JSON.stringify(values, null, 2))
}

main()
