// A form embedded in a longer-lived bare-tui app.
//
//   bare examples/embedded.js
//
// Unlike form.run() (which spins up its own Program and tears the terminal down
// on submit), here the form is just a component inside a host app. On submit the
// host switches to a result view and KEEPS RUNNING — the terminal is never
// restored until the host itself quits. Press n to fill it again, q to quit.
//
// The contract: the form emits 'form.submit' / 'form.cancel' messages; it never
// calls quit. The host decides what those mean.
const { Program, quit, key, style } = require('bare-tui')
const form = require('..')

const title = (s) => style().bold(true).foreground('cyan').render(s)
const dim = (s) => style().faint(true).render(s)

function makeForm() {
  return form.create({
    fields: [
      form.text({ name: 'name', label: 'Name', required: true }),
      form.select({ name: 'plan', label: 'Plan', options: ['free', 'pro'] })
    ]
  })
}

class App {
  constructor() {
    this.form = makeForm()
    this.result = null // set once the form submits
  }

  init() {
    return this.form.init()
  }

  update(msg) {
    // Result screen: the form is done; the app lives on until we choose to quit.
    if (this.result) {
      if (key.matches(msg, 'q', 'ctrl+c')) return [this, quit]
      if (key.matches(msg, 'n')) {
        this.form = makeForm()
        this.result = null
        return [this, this.form.init()]
      }
      return [this, null]
    }

    // Form screen: react to the messages the form emits.
    if (msg && msg.type === 'form.submit') {
      this.result = msg.values // ← no quit: the terminal stays up
      return [this, null]
    }
    if (msg && msg.type === 'form.cancel') return [this, quit]

    const [f, cmd] = this.form.update(msg)
    this.form = f
    return [this, cmd]
  }

  view() {
    if (this.result) {
      return [
        title('  ✓ All set!'),
        '',
        `  name: ${this.result.name}`,
        `  plan: ${this.result.plan}`,
        '',
        dim('  n new · q quit')
      ].join('\n')
    }
    return title('  Embedded form demo') + '\n\n' + this.form.view()
  }
}

new Program(new App()).run()
