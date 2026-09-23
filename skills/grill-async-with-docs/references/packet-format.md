# Packet and response contract

Use UTF-8 JSON. The packet is the agent's source of truth; render all HTML from it.
For a complete example, read [cancellation.packet.json](../examples/cancellation.packet.json).
The CLI validates structure and references. It cannot validate semantic coverage.

## Packet

```json
{
  "schema_version": 1,
  "packet_id": "cancel-order",
  "revision": "1",
  "title": "Clarify order cancellation rules",
  "intro": "Agree on cancellation scope and how related cases should be handled.",
  "readiness": "ready",
  "coverage_note": "Describe investigated alternatives and remaining gaps in plain language.",
  "contexts": [],
  "questions": [],
  "constraints": [],
  "internal": {"scout_log": [], "coverage": [], "open_items": []}
}
```

- `packet_id`: lowercase slug, starting with a letter.
- `revision`: nonempty string. Increment when public meaning/content changes.
- `readiness`: `ready` or `partial`. Partial requires an explanatory coverage note
  and prevents a claim that the response is ready for review.
- `questions`: nonempty array. IDs begin with an uppercase letter and contain
  only uppercase letters, digits, or underscores. Prefer S01... and T01....
- `internal`: flexible evidence and working records. This object, and any
  per-question `internal`, is excluded from rendered HTML and its fingerprint.
- `contexts`: optional known or unavailable facts used in conditions. Example:
  `{"id":"F01","label":"Online payment","status":"confirmed","value":true}`.
  Unknown facts use `"status":"unknown"` and omit `value`; do not promote an
  unconfirmed hypothesis into a confirmed context to simplify routing.
  Contexts are immutable in the form. If BA/DEV can establish a fact during this
  handoff, represent that investigation as a question with an owner instead of
  an unknown context that can only be updated by issuing a revised packet.

## Questions

```json
{
  "id": "S01",
  "audience": "spec",
  "owner": "BA / Product",
  "section": "Cancellation scope",
  "title": "What cancellation scope is allowed?",
  "context": "An order can contain multiple items.",
  "why": "Cancellation scope affects discount allocation and refunds.",
  "type": "single",
  "required": true,
  "allow_other": true,
  "options": [
    {"value":"whole","label":"Whole order only"},
    {"value":"partial","label":"Whole order or individual items"}
  ]
}
```

Required fields: `id`, `audience` (`spec` or `tech`), `owner`, `title`, `type`.
`required` defaults to true; `allow_other` defaults to true. All questions also
offer Undecided. Optional `recommendation` is explanatory text, never a default.
Question `section`, `context`, `why`, and `recommendation` are plain text.

Types:

| Type | Input | Extra fields |
|---|---|---|
| `single` | One option | Nonempty `options` with unique string value and label; optional detail |
| `multi` | Several options | Same options format; none selected is unanswered |
| `text` | Free text | Scenario/answer expectations belong in context |
| `number` | Finite number, including zero | Optional numeric `min`, `max`; optional text `unit` |
| `table` | Rows added by respondent | Nonempty `columns`; each has key, label, type, optional required |

Column types: `text`, `number`, `single`, `multi`. Choice columns need options.
Column keys match `[a-z][a-z0-9_]*`, excluding constructor/prototype. Required
defaults to true. All cells in a newly added row are checked; empty rows are not
silently discarded. Tables support flat columns, not nested or conditional rows.
Use a single row per business entity to collect its name and associated rules.

Every normal answer can also include a note. Other/Undecided use a note instead
of the normal value. Other asks for rule, exception, and example; Undecided asks
for missing context and/or who can confirm. Both remain unresolved for routing.

## Conditions and prerequisites

`when` defaults to true. Expressions are JSON data, never executable JS strings:

```json
{
  "all": [
    {"question":"S01","op":"eq","value":"partial"},
    {"question":"S03","op":"eq","value":"yes"}
  ]
}
```

- Combinators: `all`, `any` (nonempty arrays), `not` (one condition).
- Leaves reference exactly one `question` or `fact`.
- Operators: `eq`, `ne`, `in` (value is an array), `contains` (multi-choice
  question), `gt`, `gte`, `lt`, `lte`, `answered` (no value).
- Question choice values must exist. Use number literals for numeric comparisons.
- Tables only support `answered`; collect per-row decisions together.
- All/any/not preserve unknowns; undecided is not false. An inactive referenced
  question supplies no usable answer, including through negation. Short-circuit
  logic can still settle a condition through an independent, known operand.
- `requires: ["S01", "T01"]` means those answers must be usable before this
  question can be answered, even if they do not select a branch. Use it for
  semantic prerequisites; unrelated questions can be answered in any order.
- Prerequisites may cross tabs. The form links to their IDs and shows which role
  needs to answer. Keep the combined dependency graph acyclic.

A parent edit gives that answer a new ID. Dependent records retain the old
dependency IDs in `basis`; they are marked `needs_review` and cannot drive later
questions until explicitly confirmed again. This applies even if the parent is
changed away and then back. Optional fields do not provide usable blank answers.

Use constraints for contradictions, not as routing edges:

```json
{
  "id": "C01",
  "when": {"all": [
    {"question":"S08","op":"eq","value":"no"},
    {"question":"T02","op":"eq","value":"async"}
  ]},
  "message": "BA expects an immediate result, but DEV selected background processing; align on the expected behavior."
}
```

Constraint true means a conflict; false means none; unknown is pending. Express
applicability inside the condition. Do not create permanently pending constraints
on optional inputs with no intended way to answer them.

## Responses, identity, and history

The renderer creates a SHA-256 fingerprint from canonical public packet data.
Exports include packet ID, revision, fingerprint, respondent, timestamps, answers,
cleared-answer markers, history, and a computed evaluation snapshot. The CLI
recomputes that snapshot; it never trusts the exported result as a verdict.

```json
{
  "status": "answered",
  "value": "partial",
  "note": "Also applies to unpaid orders.",
  "answered_by": "Lan / BA",
  "answer_id": "unique-id-generated-on-edit",
  "updated_at": "2026-09-23T08:00:00.000Z",
  "basis": {}
}
```

For Other/Undecided, use status `other`/`unknown`, omit value, provide note.
`basis` maps direct question dependencies to their answer IDs. Use the form or
the bundled core's `updateAnswer` to generate records; manually fabricated
dependency IDs will require review. Inactive answers and history are retained
but excluded from effective decisions. Cleared-answer markers prevent an older
file from silently restoring a deliberately deleted answer.

Import validates the entire file before modifying state. A different packet,
revision, fingerprint, unknown question, or malformed response is rejected.
Same-version concurrent answers are merged only after explicit choices for
conflicts. Unchanged answer IDs and new, nonconflicting answers merge directly.
Version migration is an agent reconciliation task, not a browser guess.

## Files and ownership

Keep the agent packet/evidence separate from the shareable HTML. The HTML contains
both role tabs and all public question text. Response JSON contains both roles'
answers and history. Tabs are not privacy boundaries. No external scripts, fonts,
network requests, API keys, or server are required.

Browser local storage is best effort and may be unavailable or cleared. Export
JSON is the portable saved copy. The page cannot rewrite its original HTML file;
opening that HTML on another machine starts blank until answers are imported.
