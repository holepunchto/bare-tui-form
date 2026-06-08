// A dressed-up form: gradient title, a rounded truecolor frame with a dark
// background, accent focus "glow", and the validating spinner on submit.
//
//   bare examples/glow.js
//
// Everything here is just a `theme`: each chrome element is a string→string
// function using bare-tui's `style` (truecolor hex, borders, padding, bg), plus
// the new `theme.frame` hook that wraps the whole form in a border/background.
// Taste, not noise — one accent (cyan) for focus, one gradient for the banner.
const { style } = require('bare-tui')
const form = require('..')

// --- a tiny truecolor gradient (the "glow") --------------------------------
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const lerp = (a, b, t) =>
  '#' +
  hex(a)
    .map((v, i) =>
      Math.round(v + (hex(b)[i] - v) * t)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')

function gradient(text, stops) {
  const chars = [...text]
  const n = chars.length
  return chars
    .map((ch, i) => {
      const p = n <= 1 ? 0 : (i / (n - 1)) * (stops.length - 1)
      const lo = Math.floor(p)
      const col = lerp(stops[lo], stops[Math.min(lo + 1, stops.length - 1)], p - lo)
      return style().bold(true).foreground(col).render(ch)
    })
    .join('')
}

// --- the palette ------------------------------------------------------------
const ACCENT = '#22d3ee' // cyan — focus / sections
const SOFT = '#c7d2fe' // lavender — resting labels
const MUTE = '#6f6e92' // muted — help / descriptions
const BG = '#0d0b1f' // deep indigo background

const theme = {
  title: (s) => gradient(s, ['#f0abfc', '#a78bfa', ACCENT]),
  description: (s) => style().italic(true).foreground(MUTE).render(s),
  sectionTitle: (s) =>
    style()
      .bold(true)
      .foreground(ACCENT)
      .render('▸ ' + s),
  label: (s) => style().foreground(SOFT).render(s),
  labelFocused: (s) =>
    style()
      .bold(true)
      .foreground(ACCENT)
      .render('● ' + s),
  help: (s) => style().foreground(MUTE).render(s),
  error: (s) => style().foreground('#fda4af').render(s),
  validating: (s) => style().foreground('#a78bfa').render(s),
  requiredMarker: ' ✦',
  errorPrefix: '✗ ',
  spinner: { frames: 'points', fps: 10 },

  // The showpiece: a rounded, padded, background-filled box around the form —
  // a one-line descriptor instead of a style() chain (see form.frame / .frames).
  // No fixed width: the box hugs its content (and the background fills it).
  frame: { border: 'rounded', color: '#a78bfa', background: BG, padding: [1, 3] }
}

// A mock availability check, so submit shows the glowy "validating…" spinner.
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function checkHandle(v) {
  await wait(700)
  return ['admin', 'root'].includes(v.toLowerCase()) ? `@${v} is taken` : null
}

async function main() {
  const f = form.create({
    title: '✶  Create your space  ✶',
    description: 'A few details and you are in.',
    theme,
    fields: [
      form.text({
        name: 'handle',
        label: 'Handle',
        required: true,
        autofocus: true,
        validate: checkHandle
      }),
      form.text({
        name: 'email',
        label: 'Email',
        required: true,
        validate: (v) => (v.includes('@') ? null : 'needs an @')
      }),
      form.select({ name: 'plan', label: 'Plan', options: ['Free', 'Pro', 'Team'], selected: 1 }),
      form.group({
        name: 'profile',
        title: 'Profile',
        fields: [
          form.text({ name: 'displayName', label: 'Display name', placeholder: 'shown publicly' }),
          form.textarea({ name: 'bio', label: 'Bio', rows: 3, help: 'a sentence or two' })
        ]
      }),
      form.confirm({ name: 'newsletter', label: 'Send me the occasional update' })
    ]
  })

  const values = await form.run(f, { mouse: false })
  if (values === null) console.log('\nCancelled.')
  else console.log('\nWelcome:\n' + JSON.stringify(values, null, 2))
}

main()
