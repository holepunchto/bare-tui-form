// A standalone form, run with form.run().
//
//   bare examples/signup.js
//
// Shows every field type, per-field validation, and the run() helper that wires
// the form into a Program and resolves with the collected values (or null if the
// user cancels with ctrl+c).
const form = require('..')

const isEmail = (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : 'enter a valid email')

async function main() {
  const f = form.create({
    title: 'Create your account',
    fields: [
      form.text({ name: 'name', label: 'Name', placeholder: 'Ada Lovelace', required: true }),
      form.text({
        name: 'email',
        label: 'Email',
        placeholder: 'you@example.com',
        validate: isEmail
      }),
      form.number({ name: 'age', label: 'Age', min: 13, max: 120, integer: true }),
      form.select({ name: 'plan', label: 'Plan', options: ['free', 'pro', 'enterprise'] }),
      form.radio({
        name: 'theme',
        label: 'Theme',
        options: [
          { label: 'Light', value: 'light' },
          { label: 'Dark', value: 'dark' }
        ]
      }),
      form.multiselect({
        name: 'interests',
        label: 'Interests',
        description: 'space to toggle',
        options: ['code', 'music', 'art', 'sport']
      }),
      form.textarea({ name: 'bio', label: 'Bio', description: 'tab to move on' }),
      form.confirm({ name: 'tos', label: 'Accept the terms', required: true })
    ]
  })

  const values = await form.run(f)
  // run() owns the Program: it quits and restores the terminal before resolving,
  // so it's safe to print here. To keep a TUI running after submit, embed the
  // form instead and handle form.submit yourself — see examples/embedded.js.
  if (values === null) console.log('\nCancelled.')
  else console.log('\nSubmitted:\n' + JSON.stringify(values, null, 2))
}

main()
