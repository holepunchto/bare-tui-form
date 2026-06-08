// theme — how a form's chrome is styled.
//
// A theme is a small bag of style functions (string → string) plus a couple of
// literal markers. Every field renders its label, description, error, and
// validating line through the theme, and the form renders its title and help
// footer through it. Pass a partial theme to form.create({ theme }) and it's
// merged over these defaults, so you override only what you care about:
//
//   form.create({
//     theme: {
//       title: (s) => style().bold(true).foreground('magenta').render(s),
//       error: (s) => style().foreground('yellow').render(s),
//       spinner: { frames: 'line', fps: 12 }
//     },
//     fields: [...]
//   })
//
// Field *controls* themselves (the textinput cursor, the select dropdown
// colours) are styled by bare-tui, not here — this theme covers the form chrome.
const { style } = require('bare-tui')

const defaultTheme = {
  title: (s) => style().bold(true).render(s),
  sectionTitle: (s) => style().bold(true).render(s), // a nested-object section heading
  label: (s) => s,
  labelFocused: (s) => style().bold(true).render(s),
  description: (s) => style().faint(true).render(s),
  error: (s) => style().foreground('red').render(s),
  validating: (s) => style().foreground('cyan').render(s),
  help: (s) => style().faint(true).render(s),

  requiredMarker: ' *', // appended to a required field's label
  errorPrefix: '✗ ', // prefixed to an error message
  spinner: {}, // { frames, fps } for the validating spinner; see startSpinner

  // Optional: wrap the whole rendered form in a border / background / padding.
  // May be a function (content, { width, title }) => string for full control, or
  // a plain descriptor object that merge() turns into one via frame() — e.g.
  //   frame: { border: 'rounded', color: '#a78bfa', padding: [1, 2], width: 56 }
  // The form measures the rows it adds so scrolling still fits the terminal.
  frame: null
}

// Build a frame function from a descriptor, so the common case is one line
// instead of a hand-written style() chain:
//
//   form.frame({ border: 'rounded', color, background, padding, width, align })
//
// `border` is a name ('normal' | 'rounded' | 'thick' | 'double') or a bare-tui
// border char object; `color` paints the border line; `background` fills the box
// (content keeps its own colours); `padding` is a number or [v, h] / [t, r, b, l].
function frame(opts = {}) {
  const border = typeof opts.border === 'string' ? style.borders[opts.border] : opts.border
  return (content) => {
    let s = style()
    if (border) s = s.border(border)
    if (opts.color) s = s.borderForeground(opts.color)
    if (opts.background) s = s.background(opts.background)
    if (opts.padding !== undefined && opts.padding !== null) {
      s = s.padding(...[].concat(opts.padding))
    }
    if (opts.width) s = s.width(opts.width)
    if (opts.align) s = s.align(opts.align)
    return s.render(content)
  }
}

// Ready-made, palette-neutral frame presets (drop straight into theme.frame):
//   form.create({ theme: { frame: form.frames.rounded } })
const frames = {
  normal: frame({ border: 'normal', padding: [0, 1] }),
  rounded: frame({ border: 'rounded', padding: [0, 1] }),
  thick: frame({ border: 'thick', padding: [0, 1] }),
  double: frame({ border: 'double', padding: [0, 1] })
}

// Shallow-merge a user theme over the defaults. Functions and markers replace
// wholesale; `spinner` is replaced as a unit when provided. A `frame` given as a
// plain descriptor object is normalized to a frame function here.
function merge(user) {
  const merged = { ...defaultTheme, ...(user || {}) }
  if (merged.frame && typeof merged.frame === 'object') merged.frame = frame(merged.frame)
  return merged
}

module.exports = { defaultTheme, merge, frame, frames }
