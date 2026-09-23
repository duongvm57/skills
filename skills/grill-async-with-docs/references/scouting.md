# Scout before handoff

## Evidence and decision map

For each scope topic, record:

- Existing facts with inspected source, location, and revision/date if available.
- Desired behavior explicitly stated in the spec.
- Conflicts between sources; code is not automatically the desired behavior.
- Open decisions, owner, impact, and what they unblock.
- Hypotheses explored without treating them as human answers.

Inspect source material rather than relying on a file name or a search snippet.
When a claimed fact cannot be verified, mark it unknown and retain its provenance.
Check an existing glossary for overloaded terms before building branches.

## Branch exploration

For each material alternative, ask what it changes about actors/permissions,
states/transitions, data/money calculations, errors/retries/concurrency, external
systems, notifications/audit, and migration/compatibility. Explore the dimensions
that apply to the feature, not a generic checklist of unrelated concerns.

For example, hypothetical partial cancellation leads to investigations of line
items, payment allocation, voucher thresholds, shipping charges, inventory, and
state transitions. A discovered whole-order payment record is evidence of work
needed, not proof that partial cancellation is forbidden. Turn voucher policy
into a BA question and refund idempotency into a DEV question.

Maintain a worklist of (decision, alternative, consequence). Deduplicate evidence
lookups and equivalent downstream questions. Explore high-impact interactions
between decisions explicitly. Use a table for regular state × role rules; use
numbers/text as parameters when the difference does not change the investigation.

Each explored branch ends as one of:

- `covered`: material consequences have evidence and questions/known decisions.
- `unresolved`: a missing fact or decision prevents further useful analysis.
- `deferred`: an explicit scope or resource boundary stopped exploration.

Store the reason and remaining consequences. A quiet worklist is not a coverage
argument if relevant alternatives were never added to it.

## Cross-owner dependencies

First resolve discoverable technical facts. Ask independent business outcomes
before selecting implementation. When engineering choices change the user
experience, present understandable alternatives and verified consequences.
If no option is verified feasible, collect requirements and priorities and mark
feasibility unresolved. Avoid invented cost/time estimates.

For genuinely coupled choices, ask about valid combinations as one decision or
record a hard prerequisite. Routing dependencies must be acyclic; consistency
constraints may relate multiple answers without becoming routing edges.

## Suggested internal record (flexible, not a second public schema)

```json
{
  "scout_log": [{
    "id": "E01",
    "investigation": "Payment granularity",
    "hypothesis": "If partial cancellation is permitted",
    "sources": ["src/payments.ts:12 at revision abc123"],
    "finding": "Current payment record references order_id only",
    "kind": "fact",
    "questions": ["S04", "T02"]
  }],
  "coverage": [{
    "topic": "Partial cancellation",
    "alternative": "Allow individual lines",
    "status": "covered",
    "evidence": ["E01"],
    "questions": ["S04", "T02"],
    "stop_reason": "Allocation policy and implementation decisions exposed"
  }],
  "open_items": [{
    "description": "Provider refund limits unavailable",
    "owner": "DEV",
    "impact": "Feasibility of repeated partial refunds remains open"
  }]
}
```

Render important limitations in public `coverage_note` in language both roles can
understand. Internal records remain in the packet JSON; they are not embedded in
the HTML. Explicitly supplied new facts may reopen previously covered branches.
