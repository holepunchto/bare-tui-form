# Contributing to bare-tui-form

Guidance for an AI (or human) **extending** bare-tui-form — especially the JSON
Schema mapping. The README is the user-facing API; this file is about the one
thing that makes this package different from a plain form builder: **it ingests
untrusted data.** Read this before adding a feature, and you'll know which ideas
are welcome, which need a cap and a test, and which should be turned down.

## The one assumption that drives everything

`fromSchema(schema, opts)` is fed data **someone else authored** — an LLM
emitted it, a peer sent it over the wire, a config file was edited. The whole
point of the package is "a model describes questions as a schema, we render a
real form." So the schema, its `enumNames`, its `pattern`s, its `default`s, and
any `formData` you rehydrate are all **hostile until proven otherwise.**

Everything you compile, render, or use as a key from that data is an attack
surface. `harden.js` holds the defenses; `schema.js` applies them at the
boundary. The posture is **secure-by-default**: a caller who actually trusts the
source opts out with `{ trusted: true }` / `{ limits }`. A new feature must
preserve that posture — it must be safe when `trusted` is false, which is the
default.

By contrast, `form.create(...)` and the field factories are **your own code** —
not a trust boundary, not sanitized. The split matters: hardening lives at
`fromSchema`, not in the form engine. Don't push sanitization down into the
fields (it would break `setValues`/`value()` round-tripping and slow the hot
render path); add it at the boundary where untrusted data enters.

## The five questions every new schema feature must answer

Before you map a new keyword (`$ref`, `patternProperties`, `dependencies`,
`oneOf`, a new `format`, nested objects, …), walk this list. If any answer is
"yes" and you don't have the matching mitigation, the feature isn't ready.

1. **Does it fetch anything?** (a URL, a file, a remote schema, a hostname
   lookup) → **Stop.** This is the bright line. See "The hard no" below.
2. **Does it recurse or expand?** (nested schemas, `$ref`, `allOf`/`anyOf`
   merging) → it needs a **depth cap and cycle detection**, or it's a stack
   overflow / billion-laughs waiting to happen.
3. **Does it compile a regex?** (`pattern`, `patternProperties`, a regex-backed
   `format`) → it **must** go through `harden.compilePattern`, never
   `new RegExp(untrusted)` directly. That's the ReDoS guard.
4. **Does it render a string to the terminal?** (any new label, title,
   description, option, placeholder, error text derived from the schema) → it
   **must** go through `harden.cleanText`. Raw ESC/OSC bytes in a label can
   repaint the screen or set the window title.
5. **Does it use schema data as an object key?** (`properties` names,
   `patternProperties`, `dependencies`, `$defs`) → it **must** go through
   `harden.assertSafeKey`, or it's a prototype-pollution vector.

And one that's always true: **can a malicious input make it slow, huge, or
crash?** If so, it needs a **size cap** (add it to `DEFAULT_LIMITS`) and it must
**fail closed** — throw a clear error or drop the feature with a warning, never
silently build something enormous.

## The hard no: nothing fetches

The single feature class to refuse outright is **anything that resolves an
external resource at build time.** Concretely:

- **Remote `$ref`** (`$ref: "https://…"`) — the form would issue requests to
  attacker-chosen URLs. That's SSRF (probe internal services, exfiltrate via
  the URL) the moment a schema is rendered. No.
- **Remote `$schema` / dialect loading**, fetching meta-schemas, or any
  "download and merge."
- **`format` validators that imply a lookup** — e.g. resolving a hostname,
  checking a URL is reachable, DNS. A `format` must be a **pure, bounded,
  in-process predicate** (like the existing `email`/`uri` regex checks).
- **Reading files** the schema names.

This holds even when `{ trusted: true }`. Trust lets a caller relax the ReDoS
screen and the size caps; it does **not** turn this into a network client. If
someone genuinely needs remote `$ref` resolution, that belongs in a separate,
explicitly-opted-in resolver the caller runs _before_ handing us a fully-inlined
schema — not inside `fromSchema`.

## Risk classification of the obvious next features

| Feature                                                          | Risk        | Verdict                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| More `format`s (pure regex/predicate, bounded)                   | low         | **Welcome** — add to `FORMATS`, must be linear-time on bounded input                                                                                                                                                                                  |
| More primitive constraints (`exclusiveMinimum`, `multipleOf`, …) | low         | **Welcome** — guard every numeric through `safeNumber`, surface nothing new                                                                                                                                                                           |
| `readOnly` → disabled field, `title`/`description` polish        | low         | **Welcome** — still `cleanText` every string                                                                                                                                                                                                          |
| Nested objects / `properties` recursion                          | medium      | **Done** (`schema.js` → object section; `form.js` flatten). Depth-capped, `assertSafeKey` per level, dotted paths, adversarial tests in `test/nested.js`                                                                                              |
| `oneOf` / `anyOf` / `if`-`then`-`else` / `const`                 | medium-high | **Done** — built on the dynamic-field-set engine (`_activeWhen` + `_recompute` in `form.js`). Branch count capped, mixed branches refused, tests in `test/dynamic.js`                                                                                 |
| `array` of objects (repeatable subform)                          | medium-high | **Done** — rebuildable field tree with id-keyed instance cache (`_build` + array state in `form.js`). `maxArrayItems` caps add + rehydrate, primitive/nested-array items refused, tests in `test/array.js`                                            |
| `uiSchema` presentation (`ui:order`, `ui:widget`, …)             | low-medium  | **Done** (a reasonable subset; `schema.js`). uiSchema strings are untrusted → `cleanText`; `ui:widget` only _selects_ (a built-in or a name from the `widgets` registry), never injects code; unknown widgets warn + fall back. Tests in `test/ui.js` |
| `allOf` (schema merge)                                           | medium-high | **Design discussion first** — static merge of subschemas is combinatorial and conflict-ambiguous; cap and merge deterministically, never unboundedly                                                                                                  |
| `patternProperties`, `dependencies`                              | medium-high | **Care** — keys are schema-derived (`assertSafeKey`), regexes are untrusted (`compilePattern`), counts need caps                                                                                                                                      |
| Local `$ref` / `$defs`                                           | high        | **Care** — needs **cycle detection** + depth cap or it's a self-reference DoS                                                                                                                                                                         |
| Remote `$ref`, remote schema, network `format`                   | critical    | **No** — see "The hard no"                                                                                                                                                                                                                            |

**Building on the dynamic-field-set engine.** `oneOf`/`anyOf`/`if`-`then`-`else` already added the capability for the _active set of fields to depend on a value_: a field/layout-item carries an `_activeWhen()` predicate (a closure over controller fields), the form recomputes the active set after every keystroke, and inactive fields are hidden, unfocusable, uncollected, and unvalidated. A new feature that needs conditional visibility (e.g. `dependencies`) should reuse this — emit `variant`/`conditional` defs or attach `_activeWhen`, don't invent a parallel show/hide path. A feature that changes the field set's _size_ at runtime (more array shapes) should reuse the **rebuildable build** instead: mutate the array state and call `_build()` + `_recompute()`, and key any new repeating instances by a stable id in the cache (never by position) so values survive reorders — don't rebuild instances from scratch and lose their state.

When in doubt, the answer is "ship the low-risk version, leave a clear error for
the rest." That's the existing pattern: unsupported shapes **throw a descriptive
error** (`nested object "addr" is not supported yet`) rather than silently doing
the wrong — or dangerous — thing. A loud "not supported" is a feature, not a gap.

## How to add a feature safely (the pattern to copy)

1. **Sanitize at the boundary, in `schema.js`** — never in the fields. Every
   string through `cleanText`, every numeric through `safeNumber`, every key
   through `assertSafeKey`, every regex through `compilePattern`.
2. **Add a cap to `DEFAULT_LIMITS`** for any new collection or recursion, and
   make it overridable via `opts.limits`. Pick a default generous for real use,
   small enough that abuse can't exhaust memory/CPU.
3. **Fail closed, and say so.** Exceeding a cap throws a clear error. Dropping a
   risky-but-non-fatal thing (a refused pattern, a clamped length) pushes a
   string onto `ctx.warnings`, which surfaces on `form.warnings`. **No silent
   caps** — if you bound something, the caller must be able to see it.
4. **Don't make `trusted` load-bearing for safety.** A feature must be safe with
   `trusted: false`. `trusted` may _improve fidelity_ (compile patterns verbatim,
   raise caps); it must never be the _only_ thing standing between a default-mode
   caller and a hang or a crash.
5. **Write the adversarial test.** Every defense in `test/security.js` exists
   because a specific attack was considered. A new feature adds its own: the
   malicious input, the proof it's neutralized, and the proof the legitimate case
   still works. A ReDoS feature proves validation completes instantly; a
   recursion feature proves a cyclic/deeply-nested schema is bounded, not a hang.

## A boundary you can't enforce here, but must document

This is a **terminal UI**. The validation it runs (`required`, `pattern`,
`minLength`, async checks) is for **UX** — guiding the user to a well-formed
answer. It is **not** an authority. Whoever consumes `form.value()` (the LLM
loop, the service, the peer) must **re-validate the result against the schema
server-side / out-of-band.** Never let a feature imply that passing the form's
client-side checks means the data is trusted. If you add validation that _looks_
authoritative, document loudly that it isn't.

## Quick checklist

- Untrusted string rendered → `cleanText`. (Skipped it → terminal injection.)
- Untrusted regex compiled → `compilePattern`, never raw `new RegExp`. (ReDoS.)
- Schema-derived object key → `assertSafeKey`. (Prototype pollution.)
- Untrusted numeric constraint → `safeNumber`. (Type confusion / NaN compares.)
- New collection or recursion → cap in `DEFAULT_LIMITS` + cycle/depth guard.
- Bounded/dropped something → push to `form.warnings`, never silent.
- Feature relies on `trusted` to be safe → redesign; default must be safe.
- Feature fetches a URL/file/host → reject it; that's the hard no.
- Added a feature → added its adversarial test in `test/security.js`.
- Unsupported shape → throw a clear, named error, don't guess.
