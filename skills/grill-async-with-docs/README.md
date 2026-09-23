# grill-async-with-docs

Prepare one asynchronous clarification interview for BA and DEV, based on
`grill-with-docs`. Investigate plausible answer branches in advance, then deliver
**one offline HTML file with BA and DEV tabs** that share a response.

## Use the skill

```text
$grill-async-with-docs
Read the spec at <path> and code at <path>; prepare an HTML question packet for BA and DEV.
```

When answers come back:

```text
$grill-async-with-docs
Reconcile packet.json with order-v1-answers.json, investigate the selected branches,
update decisions that are now clear, and collect any follow-up questions from the right owners.
```

## BA → DEV workflow

1. The agent creates `packet.json` and `interview.html` from the actual spec and code.
2. BA opens the HTML and fills in the **BA — Business** tab. Questions appear as
   their conditions become applicable.
3. BA clicks **Export answers** to download JSON and sends it with the HTML to DEV.
4. DEV opens the HTML, clicks **Import answers**, fills in the **DEV — Technical**
   tab, then exports the combined response.
5. Send the combined JSON and original packet back to the agent for reconciliation
   and branch investigation.

DEV can go first, or each person can fill in a separate copy. If imported copies
contain different answers to the same question, the form asks which answer to
keep. Dependent questions are recalculated; the most recent timestamp is never
selected automatically.

Both tabs are in the same file, so anyone holding it can view either tab. Questions
are classified by who owns the decision, not by whether their wording sounds
technical.

## Save and transfer answers

- **Temporary autosave:** uses browser local storage when available. Reopening the
  same file in the same browser may restore the draft. This is not a durable backup
  and does not sync across people or simultaneously open windows.
- **Export JSON:** creates a portable response for another machine or respondent,
  including both BA and DEV answers, respondent attribution, and change history.
- **Import JSON:** checks the packet, revision, and fingerprint before merging.
  A different revision requires agent reconciliation; the form does not guess how
  to migrate answers.
- **The original HTML is not rewritten:** sharing it without the JSON does not
  carry completed answers. No server, API key, or network connection is required.

When an earlier answer changes, dependent answers keep their text but must be
confirmed again. Not-applicable and waiting-for-a-condition are distinct states.
Other and Undecided remain unresolved; neither becomes a default.

## Try the example

Open [examples/cancellation.html](examples/cancellation.html) in a browser. It is
an illustrative cancellation feature, not a question set taken from a real project.

Choose “Cancel the whole order or individual items” for S01, then change it to
whole-order cancellation only. Enter “No” for S08 and “Background processing” for
T02 to see the BA–DEV conflict.

## Bundled tools

Node.js 18 or later is needed to create or reconcile files. Respondents only need
a modern browser.

```bash
node scripts/grill.mjs validate examples/cancellation.packet.json
node scripts/grill.mjs render examples/cancellation.packet.json --out interview.html
node scripts/grill.mjs reconcile examples/cancellation.packet.json answers.json --out review
```

The CLI and HTML use the same engine to evaluate conditions. `review/report.json`
contains only currently effective answers in `effective_answers`; original
responses and history are retained. `review/review.md` is the human- and
agent-readable report.

See [packet-format.md](references/packet-format.md) for the data contract. The
engine supports AND/OR/NOT, multiple choice, numbers, text, repeatable tables,
cross-tab conditions, and declared contradiction rules. Tables have flat columns;
they do not support separate dynamic branches inside each row.

## Scope and checks

One handoff is the goal. New rules from BA, unavailable external facts, or
unexplored alternatives may still require a focused follow-up packet. The HTML
only runs the prepared questions and conditions; the agent must investigate and
semantically reconcile the answers.

```bash
node --test tests/core.test.mjs
python3 tests/browser_test.py --out /tmp/grill-browser-checks
```

Browser tests use Python Playwright and Chromium. They cover conditions, history,
branch changes, import/export across browser contexts, conflicts, revisions,
tables, zero, offline use, unavailable local storage, and mobile layout.
