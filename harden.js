// harden — the security boundary for untrusted JSON Schema.
//
// fromSchema turns externally-supplied data (an LLM- or peer-authored schema,
// plus rehydration `formData`) into compiled regexes and strings painted onto a
// terminal. That makes it the one place in this library that ingests data an
// attacker may control, so it's the one place we treat as hostile. These
// primitives are the defenses; schema.js applies them at the boundary.
//
// The posture is secure-by-default: limits are enforced, control characters are
// stripped, and risky regexes are refused. A caller who genuinely trusts the
// source opts back into full fidelity with { trusted: true } / { limits }.

// Caps that bound how much work a single schema can cause. Generous enough for
// real forms, low enough that a malicious schema can't exhaust memory/CPU.
const DEFAULT_LIMITS = {
  maxFields: 200, // total leaf fields across the whole (possibly nested) schema
  maxDepth: 8, // how deeply objects may nest (a recursion / stack-overflow bound)
  maxEnum: 1000, // entries in an enum / items.enum (and rehydrated arrays)
  maxBranches: 20, // branches in a oneOf/anyOf variant selector
  maxArrayItems: 100, // entries an array-of-objects can hold (add + rehydrate)
  maxStringLength: 100000, // ceiling for a text field's charLimit
  maxPatternLength: 1000, // source length of a `pattern` regex
  maxTextLength: 5000, // length any single rendered string is truncated to
  maxInputTested: 10000 // input length a `pattern` is tested against
}

// Property names that, used as an object key, can corrupt the prototype chain
// when the collected values object is built (out[key] = …). Refused outright.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

// C0 controls (incl. ESC 0x1b, the start of every ANSI/OSC sequence), DEL, and
// C1 controls (incl. CSI 0x9b). Anything in here, rendered to a terminal, can
// move the cursor, rewrite the screen, set the window title, or worse — so we
// strip it from every schema-derived string before it can reach the output.
// Built from an ASCII string literal so no control bytes live in this source.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f]', 'g')

// Coerce to a string, strip terminal-control characters, and truncate. Returns
// the value untouched when it's null/undefined so "absent" stays absent.
function cleanText(value, max = DEFAULT_LIMITS.maxTextLength) {
  if (value === null || value === undefined) return value
  let s = String(value).replace(CONTROL_CHARS, '')
  if (max > 0 && s.length > max) s = s.slice(0, max)
  return s
}

// A finite number, or undefined. JSON Schema constraints (minimum, maxLength, …)
// are trusted only when they really are finite numbers; "5", NaN, Infinity, and
// objects are ignored rather than fed into comparisons or RegExp/charLimit math.
function safeNumber(n) {
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

// Throw if a property name would be dangerous as an object key.
function assertSafeKey(name) {
  if (FORBIDDEN_KEYS.has(name)) {
    throw new Error(`fromSchema: property name "${name}" is not allowed`)
  }
}

// Heuristic ReDoS guard. The catastrophic-backtracking family is an unbounded
// quantifier applied to a group that itself contains an unbounded quantifier:
// (a+)+, (a*)*, (.*)*, ([a-z]+)* … We scan for exactly that shape. The check is
// deliberately conservative — it may refuse some safe patterns, in which case
// the pattern constraint is dropped (the form still works, just without that
// one client-side check) and a warning is recorded. It is NOT a general
// safe-regex prover; { trusted: true } bypasses it for known-good schemas.
function isSafeRegexSource(src) {
  let escaped = false
  let inClass = false
  let prevWasGroupClose = false
  let closedGroupUnbounded = false
  // Per currently-open group: did it contain an unbounded quantifier?
  const groupUnbounded = []

  for (let i = 0; i < src.length; i++) {
    const c = src[i]

    if (escaped) {
      escaped = false
      prevWasGroupClose = false
      continue
    }
    if (c === '\\') {
      escaped = true
      prevWasGroupClose = false
      continue
    }
    if (inClass) {
      if (c === ']') inClass = false
      prevWasGroupClose = false
      continue
    }
    if (c === '[') {
      inClass = true
      prevWasGroupClose = false
      continue
    }
    if (c === '(') {
      groupUnbounded.push(false)
      prevWasGroupClose = false
      continue
    }
    if (c === ')') {
      closedGroupUnbounded = groupUnbounded.pop() || false
      prevWasGroupClose = true
      continue
    }

    if (c === '*' || c === '+' || c === '{') {
      const unbounded = c === '{' ? isUnboundedBrace(src, i) : true
      // A nested unbounded quantifier: refuse.
      if (unbounded && prevWasGroupClose && closedGroupUnbounded) return false
      // Mark the enclosing group as containing an unbounded quantifier.
      if (unbounded && groupUnbounded.length > 0) {
        groupUnbounded[groupUnbounded.length - 1] = true
      }
      prevWasGroupClose = false
      continue
    }

    prevWasGroupClose = false
  }
  return true
}

// Is the `{…}` quantifier starting at `i` open-ended (`{n,}`) — the only brace
// form that backtracks unboundedly? `{n}` and `{n,m}` are bounded.
function isUnboundedBrace(src, i) {
  const close = src.indexOf('}', i)
  if (close === -1) return false // a literal '{', not a quantifier
  const body = src.slice(i + 1, close)
  return /^\d+,\s*$/.test(body) // n, with nothing after the comma
}

// Compile a `pattern` into a bounded tester, or return why it was refused.
// Returns { test } on success or { reason } when dropped. The tester caps the
// input length it inspects so even a linear-time regex can't be driven to
// pathological cost by a huge pasted value.
function compilePattern(source, opts = {}) {
  const trusted = opts.trusted === true
  const maxPatternLength = opts.maxPatternLength ?? DEFAULT_LIMITS.maxPatternLength
  const maxInputTested = opts.maxInputTested ?? DEFAULT_LIMITS.maxInputTested

  if (typeof source !== 'string' || source === '') {
    return { reason: 'pattern ignored (not a string)' }
  }
  if (source.length > maxPatternLength) {
    return { reason: `pattern ignored (longer than ${maxPatternLength} chars)` }
  }
  if (!trusted && !isSafeRegexSource(source)) {
    return { reason: 'pattern ignored (rejected as a possible ReDoS)' }
  }
  let re
  try {
    re = new RegExp(source)
  } catch {
    return { reason: 'pattern ignored (not a valid regular expression)' }
  }
  const test = (v) => re.test(String(v).slice(0, maxInputTested))
  return { test }
}

module.exports = {
  DEFAULT_LIMITS,
  FORBIDDEN_KEYS,
  cleanText,
  safeNumber,
  assertSafeKey,
  isSafeRegexSource,
  isUnboundedBrace,
  compilePattern
}
