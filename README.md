# bare-tui-form

A declarative form builder for [bare-tui](../bare-tui).

> [!NOTE]
> This an experimental library. A version 1.0.0 release will signal stability.

bare-tui ships the field _controls_ (textinput, textarea, select, radio, checkbox) and a focus ring, and deliberately stops there. This package adds the opinionated layer on top — labels, descriptions, per-field validation, focus movement, and submission — so you describe a form as data and get a working, validated, keyboard-driven UI.

```js
const form = require('bare-tui-form')

const f = form.create({
  title: 'Create your account',
  fields: [
    form.text({ name: 'name', label: 'Name', required: true }),
    form.text({ name: 'email', label: 'Email', validate: isEmail }),
    form.select({ name: 'plan', label: 'Plan', options: ['free', 'pro'] }),
    form.confirm({ name: 'tos', label: 'Accept terms', required: true })
  ]
})

const values = await form.run(f) // { name, email, plan, tos }  |  null if cancelled
```

```sh
bare examples/signup.js
```

## Running a form

Two ways, depending on whether the form owns the screen or lives inside a larger app.

### Standalone — `form.run(f)`

`run()` wires the form into a bare-tui `Program`, restores the terminal when it's done, and resolves with the collected values — or `null` if the user cancels with `ctrl+c`.

```js
const values = await form.run(f)
```

### Embedded — handle the messages

A form is a normal bare-tui component (`update`/`view`). Embed it and react to the two messages it emits:

```js
update(msg) {
  if (msg.type === 'form.submit') return [this, save(msg.values)]
  if (msg.type === 'form.cancel') return [this, quit]
  const [m, cmd] = this.form.update(msg)
  this.form = m
  return [this, cmd]
}
view() { return this.form.view() }
```

The form **never calls `quit`** — it only emits `form.submit` / `form.cancel`. So embedding it never tears the terminal down: on submit you can switch to a result view, swap in another form, or keep going, and your app stays live until _you_ decide to `quit`. (That's the difference from `run()`, which calls `quit` for you.) See [`examples/embedded.js`](examples/embedded.js) for a host app that shows a form, then continues running after submit.

`form.value()` and `form.errors()` are also available any time if you'd rather poll than react to messages.

## Fields

Each factory returns a field; pass them to `form.create({ fields: [...] })`.

| Factory                  | Control          | `value()`         |
| ------------------------ | ---------------- | ----------------- |
| `form.text(opts)`        | single-line text | `string`          |
| `form.textarea(opts)`    | multi-line text  | `string`          |
| `form.number(opts)`      | numeric text     | `number \| null`  |
| `form.select(opts)`      | dropdown         | the chosen value  |
| `form.radio(opts)`       | expanded choices | the chosen value  |
| `form.confirm(opts)`     | checkbox         | `boolean`         |
| `form.multiselect(opts)` | toggle list      | `array` of values |

Common options on every field: `name` (the key in `form.value()`), `label`, `description`, `required`, `requiredMessage`, and `validate`. `select`, `radio`, and `multiselect` take `options` (strings or `{ label, value }`). `number` takes `min` / `max` / `integer`. `confirm` treats `required` as "must be checked".

**Presentation options (the same ones [uiSchema](#presentation-uischema) exposes):** every field also accepts `help` (a hint line), `placeholder`, `hideLabel`, `autofocus`, `readonly` (shown, not editable, still collected), and `hidden` (collected, never shown). `text` takes `echoMode: 'password'`; `textarea` takes `rows`. These live on the field, not the schema layer — so a hand-built form gets them for free, and `fromSchema`'s uiSchema is just sugar that maps `ui:*` names onto them. (Field order is just the order you list them; choosing a control is just choosing the factory.)

### Structural fields (nested objects & arrays)

`form.group` and `form.array` give hand-built forms the same structure `fromSchema` produces, and you can **mix instances, groups, and arrays in one `fields` array**:

```js
form.create({
  fields: [
    form.text({ name: 'name', autofocus: true }),
    form.group({
      name: 'address',
      title: 'Address',
      optional: false,
      fields: [form.text({ name: 'street' }), form.text({ name: 'city' })]
    }),
    form.array({
      name: 'phones',
      minItems: 1,
      removable: false,
      fields: [
        { type: 'text', name: 'label' }, // item fields are DEFS, not instances
        { type: 'text', name: 'number' }
      ]
    })
  ]
})
// value → { name, address: { street, city }, phones: [ { label, number }, … ] }
```

`form.group({ optional: true })` is a checkbox-gated section. `form.array` takes `minItems`/`maxItems`/`addable`/`removable`. Its **item fields must be plain `{ type, name }` defs, not field instances** — each entry needs its own field, so a shared instance would bleed values between rows (the factory throws if you pass an instance).

### Validation

`validate(value)` returns an error string when invalid, or a falsy value when fine. `required` is checked first, then your validator.

```js
form.text({
  name: 'email',
  required: true,
  validate: (v) => (v.includes('@') ? null : 'need an @')
})
```

Validation runs when you confirm a field (enter) and again on submit. Enter won't leave an invalid field, and submit jumps focus to the first error.

### Async validation (spinner included)

Make `validate` an `async` function and the form handles the rest: while it runs it shows a spinner next to the field, gates input so the check can't be raced, and then either shows the returned error or advances. Nothing else to wire up.

```js
form.text({
  name: 'username',
  label: 'Username',
  required: true,
  validatingMessage: 'checking availability…', // shown beside the spinner
  validate: async (value) => {
    const available = await api.checkUsername(value) // your real API call
    return available ? null : 'that username is taken'
  }
})
```

Under the hood this runs as a bare-tui Cmd and comes back as a message, stamped with a per-field run id so a cancelled or superseded check can never apply a stale result. An async check only fires for a non-empty value (an empty optional field just advances). `ctrl+c` cancels an in-flight check. See [`examples/async-validation.js`](examples/async-validation.js).

#### Async checks on submit

A user can fill a form without confirming every field, so an async check might never have run by the time they submit. By default the form closes that gap: **on submit it re-runs any async validators that are dirty** (never ran, or whose value changed since they last passed), **one at a time**, behind a single footer spinner that counts progress (`validating… 2/3`). Input is gated while it runs; the first failure stops the run and focuses that field; if they all pass, the form submits. Serial (not parallel) keeps load predictable when checks hit a real API.

This is on by default. Opt out explicitly — and then **you** own making sure those checks ran:

```js
form.create({
  validateAsyncOnSubmit: false, // submit immediately; don't re-run async checks
  fields: [...]
})
```

A field that already passed its check (e.g. you confirmed it with `enter`) isn't re-run unless you edit it again. See [`examples/async-submit.js`](examples/async-submit.js).

## Styling

Pass a `theme` to `form.create({ theme })` to restyle the form chrome. A theme is a bag of `string → string` style functions plus two markers; your partial theme is merged over the defaults, so you override only what you want.

```js
const { style } = require('bare-tui')

form.create({
  theme: {
    title: (s) => style().bold(true).foreground('magenta').render(s),
    labelFocused: (s) => style().bold(true).foreground('cyan').render(s),
    error: (s) => style().foreground('yellow').render(s),
    spinner: { frames: 'line', fps: 12 } // 'dots' | 'line' | 'points' or an array
  },
  fields: [...]
})
```

| Theme key                | Styles                                       |
| ------------------------ | -------------------------------------------- |
| `title`                  | the form title                               |
| `label` / `labelFocused` | a field label (blurred / focused)            |
| `description`            | a field's description line                   |
| `error`                  | an error message                             |
| `validating`             | the spinner + validating message line        |
| `help`                   | the footer hint                              |
| `sectionTitle`           | a nested-object / array section heading      |
| `requiredMarker`         | string appended to a required label (`' *'`) |
| `errorPrefix`            | string prefixed to an error (`'✗ '`)         |
| `spinner`                | `{ frames, fps }` for the async spinner      |
| `frame`                  | wrap the whole form in a border / background |

Field _controls_ (the textinput cursor, the select dropdown colours) are styled by bare-tui itself; the theme here covers the form's own chrome.

### Framing the form (borders & backgrounds)

`theme.frame` wraps the whole rendered form in a border / background / padding. The form measures the rows your frame adds, so scrolling still fits the terminal. There are four ways to set it, easiest first:

```js
// 1. a ready-made preset
form.create({ theme: { frame: form.frames.rounded } }) // .normal / .thick / .double

// 2. a descriptor object (no style() chain)
form.create({
  theme: {
    frame: {
      border: 'rounded',
      color: '#a78bfa',
      background: '#0d0b1f',
      padding: [1, 3],
      width: 56
    }
  }
})

// 3. the builder (same options, reusable)
const fancy = form.frame({ border: 'rounded', color: '#a78bfa', padding: [1, 3] })
form.create({ theme: { frame: fancy } })

// 4. a function, for full control
const { style } = require('bare-tui')
form.create({
  theme: { frame: (s) => style().border(style.borders.rounded).padding(1, 2).render(s) }
})
```

`frame` options: `border` (`'normal' | 'rounded' | 'thick' | 'double'`, or a bare-tui border object), `color` (the border line colour), `background` (fills the box — content keeps its own colours), `padding` (a number or `[v, h]`), `width`, `align`.

Because every chrome key is just a `string → string` function over `style` (which supports truecolor `#rrggbb`), you can go as far as gradients and accent "glow" on focus. [`examples/glow.js`](examples/glow.js) is a full dressed-up form — gradient title, rounded truecolor frame, dark background, cyan focus accent — to crib from.

## Keys

| Key                 | Action                                                                          |
| ------------------- | ------------------------------------------------------------------------------- |
| `tab` / `shift+tab` | move between fields (no validation — a free escape hatch)                       |
| `enter`             | confirm the focused field and advance; on a button (array add/remove), press it |
| `ctrl+s`            | **submit** the form (emits `form.submit`)                                       |
| `ctrl+c`            | cancel (emits `form.cancel`)                                                    |
| `pageup`/`pagedown` | scroll, when the form is taller than the terminal                               |

**Submit is deliberate, not `enter`.** Enter confirms a field, advances, or presses a button — it never submits. Submitting is its own key (`ctrl+s` by default) so a form that ends in an array's **+ Add** button can't be submitted by accident. (The default is `ctrl+s` rather than a modifier+enter because most terminals can't distinguish `ctrl`/`shift+enter` from a plain `enter` — they all arrive as `\r`. In raw mode `ctrl+s` is delivered to the app, not swallowed as flow control.)

Some controls own keys while focused: `textarea` keeps `enter` for newlines (use `tab` to move on), an open `select` uses `↑`/`↓`/`enter`/`esc` for its menu, `radio` uses the arrows, and `space` toggles `confirm`/`multiselect`.

### Configuring the keys

Every form-level binding is configurable — pass a partial `keys` map (merged over the defaults). Each action is an array of chords.

```js
form.create({
  keys: {
    submit: ['alt+enter'], // if your terminal can distinguish it
    cancel: ['esc'],
    next: ['tab', 'ctrl+n'],
    prev: ['shift+tab', 'ctrl+p']
  },
  fields: [...]
})
// keys: { submit, cancel, confirm, next, prev, scrollUp, scrollDown }
```

### Scrolling

When the form is taller than the terminal, the body **scrolls to keep the focused field visible** — as you `tab` down past the fold, the view follows. The title stays pinned at the top and the help footer at the bottom; `pageup`/`pagedown` scroll a page at a time. This needs the terminal height: `form.run()` gets it automatically, and an embedded form gets it as long as you forward the `{ type: 'resize' }` message into `form.update()` (which you already do if you forward all messages).

## Forms from JSON Schema

`form.fromSchema(jsonSchema)` builds a form from a JSON Schema. Because LLMs are good at producing and consuming JSON Schema, this is the pairing it's built for: a model describes the questions it needs answered as a schema, this turns it into a real terminal form, and the answers come back as a matching JSON object.

```js
const f = form.fromSchema({
  type: 'object',
  title: 'New project',
  required: ['name', 'license'],
  properties: {
    name: { type: 'string', title: 'Project name', minLength: 2 },
    license: {
      type: 'string',
      enum: ['MIT', 'Apache-2.0', 'none'],
      enumNames: ['MIT', 'Apache 2.0', 'No license']
    },
    private: { type: 'boolean', default: false },
    features: { type: 'array', items: { enum: ['tests', 'ci', 'docs'] }, default: ['tests'] },
    teamSize: { type: 'integer', minimum: 1, maximum: 50, default: 1 }
  }
})

const values = await form.run(f) // { name, license, private, features, teamSize }
```

```sh
bare examples/schema.js
```

It's a thin mapping onto the field definitions below — `fromSchema` produces the same `{ type, name, … }` objects you can write by hand (see [`examples/from-objects.js`](examples/from-objects.js)).

### Rehydrating existing values

Pass `formData` to pre-fill the form with an existing object (like react-jsonschema-form). It overrides schema `default`s; properties it omits keep their default. This makes "edit this record" forms a one-liner, and round-trips: `form.run` gives you back the same shape.

```js
const f = form.fromSchema(schema, {
  formData: { name: 'Ada', license: 'MIT', private: true, features: ['tests', 'ci'], teamSize: 4 }
})
```

For any form (schema-built or hand-written), `form.setValues(obj)` does the same thing on demand — it's the inverse of `form.value()`.

### Untrusted schemas (security)

A JSON Schema is often **untrusted** — an LLM produced it, or it arrived from a peer. `fromSchema` treats it that way, because it's the boundary where someone else's data becomes regexes you compile and text you paint onto a terminal. It's hardened by default:

- **Terminal-control characters are stripped** from every rendered string (title, labels, descriptions, option labels) and from rehydrated `formData`. A label like `"\x1b]0;…"` can't move the cursor, repaint the screen, or set the window title.
- **`pattern` regexes are screened for ReDoS.** A catastrophic-backtracking pattern (`(a+)+$` and friends) is refused rather than compiled, the source length is capped, and matching runs against bounded input — so a schema can't hang the event loop. Invalid regexes are dropped, not thrown.
- **Prototype-pollution property names** (`__proto__`, `constructor`, `prototype`) are refused, in the schema and in `formData`.
- **Numeric constraints are validated** — a `minLength: "evil"` or `minimum: NaN` is ignored, not trusted.
- **Sizes are capped** — too many properties or too large an enum throws a clear error instead of building a multi-thousand-field form.

Anything dropped or clamped is reported on `form.warnings` (an array of strings) rather than silently swallowed:

```js
const f = form.fromSchema(untrustedSchema)
if (f.warnings.length) console.error('schema hardened:', f.warnings)
```

If you **trust** the source, opt back into full fidelity:

```js
form.fromSchema(schema, {
  trusted: true, // compile `pattern` regexes verbatim (no ReDoS screen)
  limits: { maxFields: 1000, maxEnum: 5000 } // raise the size caps
})
```

(Hand-written forms via `form.create` are your own code, so they aren't sanitized. If you feed untrusted values into `form.setValues` outside of `fromSchema`, clean them yourself — `require('bare-tui-form/harden').cleanText` is the same helper.)

### Supported subset

Tracking a useful slice of [react-jsonschema-form](https://github.com/rjsf-team/react-jsonschema-form), starting reasonable:

| Schema                             | Becomes                                    |
| ---------------------------------- | ------------------------------------------ |
| `type: 'object'` with `properties` | a form, one field per property             |
| a **nested** `type: 'object'`      | a sub-section (subform / optional section) |
| `oneOf` / `anyOf`                  | a variant selector (or a select if scalar) |
| `if` / `then` / `else`             | conditional fields driven by a controller  |
| `const`                            | a fixed, non-interactive value             |
| `type: 'string'`                   | text field                                 |
| `type: 'number'` / `'integer'`     | number field (`minimum`/`maximum`/integer) |
| `type: 'boolean'`                  | confirm (checkbox)                         |
| any `enum`                         | select (single choice)                     |
| `type: 'array'` + `items.enum`     | multiselect (choose many)                  |
| `type: 'array'` + object `items`   | a repeatable subform (add/remove entries)  |
| `required: [...]`                  | required fields                            |
| `title` / `description`            | labels & help text (form- and field-level) |
| `default`                          | initial values                             |
| `enumNames`                        | option labels                              |
| `minLength` / `pattern` / `format` | string validation                          |
| `maxLength`                        | caps input                                 |

Booleans aren't forced `true` by `required` (a checkbox always has a value), matching JSON Schema. Formats currently cover `email` and `uri`.

### Nested objects (subforms & optional sections)

A `type: 'object'` property nested inside another becomes a **sub-section**, and its `required` status decides the UX:

- A **required** nested object is an always-included **subform** — a heading and its fields, indented.
- A **non-required** nested object is an **optional section** with a checkbox gate. It auto-checks the moment the user starts filling any field inside it; toggling it off omits the whole subtree from the result. The fields stay visible the whole time — the checkbox controls _inclusion_, not visibility — and an included section's own `required` fields are validated, so a half-filled section is caught.

The collected value is nested to match the schema:

```js
const f = form.fromSchema({
  type: 'object',
  required: ['name', 'address'],
  properties: {
    name: { type: 'string' },
    address: {
      // required → an always-included subform
      type: 'object',
      title: 'Address',
      required: ['street'],
      properties: { street: { type: 'string' }, city: { type: 'string' } }
    },
    billing: {
      // not required → an optional section the user gates with a checkbox
      type: 'object',
      title: 'Billing',
      properties: { card: { type: 'string' } }
    }
  }
})

const values = await form.run(f)
// { name, address: { street, city } }            ← billing left off
// { name, address: { street, city }, billing: { card } }  ← billing filled in
```

`form.value()`, `setValues()`, and `errors()` are all path-aware: `setValues` rehydrates a nested object (and arms the gate of any section present in the data), and `errors()` keys by dotted path (`'address.street'`). Nesting is bounded by a `maxDepth` limit and the global `maxFields` cap (see the security section). See [`examples/nested.js`](examples/nested.js).

### Dynamic forms (`oneOf` / `anyOf` / `if`-`then`-`else`)

The form set can change based on a value — a selector, or another field's value. Hidden fields aren't focusable, collected, or validated; the form recomputes live as you type.

**`oneOf` / `anyOf` on a property → a variant.** A selector picks which branch applies, and only that branch's fields are live. The chosen branch's data nests under the property. (`anyOf` is rendered the same as `oneOf` — pick one — matching react-jsonschema-form's UI.) When every branch is a `const`/`enum` scalar it collapses to a plain select instead. A `const` property in a branch (the common discriminator) is collected but not editable.

```js
const f = form.fromSchema({
  type: 'object',
  properties: {
    payment: {
      title: 'Payment method',
      oneOf: [
        {
          title: 'Credit card',
          properties: { kind: { const: 'card' }, number: { type: 'string' } }
        },
        {
          title: 'PayPal',
          properties: { kind: { const: 'paypal' }, email: { type: 'string', format: 'email' } }
        }
      ]
    }
  }
})
// → { payment: { kind: 'card', number } }  or  { payment: { kind: 'paypal', email } }
```

**`if` / `then` / `else` on an object → conditional fields.** When the `if` matches the current values, the `then` fields (and their `required`) go live; otherwise the `else` fields. The supported `if` is the common discriminator shape — `{ properties: { field: { const } | { enum: [...] } } }` — matched against sibling controllers.

```js
form.fromSchema({
  type: 'object',
  properties: { country: { type: 'string', enum: ['US', 'other'] } },
  if: { properties: { country: { const: 'US' } } },
  then: { properties: { zip: { type: 'string' } }, required: ['zip'] },
  else: { properties: { postalCode: { type: 'string' } } }
})
```

Rehydration handles both: `formData` points a variant's selector at the branch its shape best matches, and conditionals resolve from the controller's value. See [`examples/dynamic.js`](examples/dynamic.js).

### Repeating sections (arrays of objects)

An `array` whose `items` is an object becomes a **repeatable subform**: a list of entries the user grows with **+ Add** and shrinks with a per-entry **✕ Remove**, each entry being the item object's fields. The result is a real array.

```js
const f = form.fromSchema({
  type: 'object',
  properties: {
    contacts: {
      type: 'array',
      title: 'Contacts',
      minItems: 1,
      maxItems: 5,
      items: {
        type: 'object',
        title: 'Contact',
        required: ['name'],
        properties: {
          name: { type: 'string', title: 'Name' },
          email: { type: 'string', title: 'Email', format: 'email' }
        }
      }
    }
  }
})
// → { contacts: [ { name, email }, … ] }
```

`minItems`/`maxItems` bound the count (the add button hides at the max; remove hides at the min), and each entry's own `required` fields are validated. Entries are tracked by a stable identity, so removing the one in the middle shifts the rest down **without scrambling their values**, and `formData` rehydrates the array to the right length. Reach the buttons with `tab`; `enter` moves through the data fields and submits past them. See [`examples/array.js`](examples/array.js).

### Presentation (uiSchema)

The schema says _what_ to collect; a [react-jsonschema-form](https://rjsf-team.github.io/react-jsonschema-form/docs/api-reference/uiSchema/)-style **`uiSchema`** says _how_ to present it. Pass it as `form.fromSchema(schema, { uiSchema })`. It's a parallel tree keyed by property name (`items` for array items, nested objects recurse). This is a terminal, not a responsive web page, so the subset is the parts that mean something here — no CSS/layout.

```js
const f = form.fromSchema(schema, {
  uiSchema: {
    'ui:order': ['title', 'rating', '*'], // field order; '*' = everything else
    title: { 'ui:autofocus': true, 'ui:placeholder': 'A headline' },
    bio: { 'ui:widget': 'textarea', 'ui:options': { rows: 6 }, 'ui:help': 'markdown ok' },
    pin: { 'ui:widget': 'password' },
    role: { 'ui:widget': 'radio' }, // an enum as radio instead of a dropdown
    source: { 'ui:widget': 'hidden' }, // collected, never shown
    plan: { 'ui:readonly': true } // shown, not editable, still collected
  }
})
```

| uiSchema key                         | Effect                                                            |
| ------------------------------------ | ----------------------------------------------------------------- |
| `ui:order`                           | property order; `'*'` stands in for the unlisted ones             |
| `ui:title` / `ui:description`        | override the schema's label / help text                           |
| `ui:help`                            | an extra hint line under the field                                |
| `ui:placeholder`                     | placeholder for text/number/select                                |
| `ui:label: false`                    | hide the field's label                                            |
| `ui:widget`                          | `textarea` (+`ui:rows`), `password`, `radio`, `hidden`, or custom |
| `ui:autofocus`                       | start focus on this field                                         |
| `ui:disabled` / `ui:readonly`        | non-interactive (shown, value still collected)                    |
| `ui:options: { addable, removable }` | gate an array's add / remove buttons                              |

Every `ui:x` may also be written `ui:options: { x: … }` (the two forms are equivalent, as in RJSF). uiSchema strings are untrusted like the schema — they're sanitized the same way, and an unknown `ui:widget` falls back to the default with a `warning` rather than failing.

**Custom widgets.** Pass a `widgets` registry — `{ name: (info) => fieldDef }` — and a `ui:widget` of that name renders your field. `info` is `{ name, label, description, required, value, schema }`; return a field definition (a `{ type, … }` object) or a field instance. This is the seam for richer custom controls later.

```js
form.fromSchema(schema, {
  uiSchema: { rating: { 'ui:widget': 'stars' } },
  widgets: {
    stars: ({ name, label }) => ({
      type: 'select',
      name,
      label,
      options: [1, 2, 3, 4, 5].map((n) => ({ label: '★'.repeat(n), value: n }))
    })
  }
})
```

See [`examples/ui-schema.js`](examples/ui-schema.js). Not yet from uiSchema: `ui:enumDisabled`/`ui:enumOrder`, `ui:emptyValue`, `ui:field`, array `orderable`, markdown, and the web-only `ui:classNames`/`ui:style` (ignored).

### Not yet

Arrays of primitives or free-form items, nested arrays (an array inside an array's items), `allOf` (schema merge), and `$ref`. Unsupported shapes — including a `oneOf` that mixes object and scalar branches — throw a clear error rather than silently building the wrong form.

## License

Apache-2.0
