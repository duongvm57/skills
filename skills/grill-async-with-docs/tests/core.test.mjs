import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Core from '../assets/engine.js';
import {documentPacket, render, reconcile} from '../scripts/grill.mjs';

const original = JSON.parse(fs.readFileSync(new URL('../examples/cancellation.packet.json', import.meta.url), 'utf8'));
const packet = documentPacket(original);
function session() {
  let response = Core.blankResponse(packet);
  return {
    get response() { return response; },
    answer(id, value, note = '') { response = Core.updateAnswer(packet, response, id, {status: 'answered', value, note, answered_by: 'Tester'}); return this; },
    special(id, status, note) { response = Core.updateAnswer(packet, response, id, {status, note}); return this; },
    clear(id) { response = Core.updateAnswer(packet, response, id, null); return this; },
    get result() { return Core.evaluate(packet, response.answers); },
  };
}
const fullBranch = () => session().answer('S01', 'partial').answer('S02', 'yes').answer('S03', ['new']).answer('S04', 'keep').answer('S05', 'keep').answer('S06', 0).answer('S07', [{role: 'Customer', can_request: 'yes', approval: 'No approval'}]).answer('S08', 'yes').answer('T01', 'yes').answer('T02', 'async').answer('T03', 'Persist key and retry safely').answer('T04', 'Line-level allocations');

test('unanswered is unknown; known disabled branch becomes inactive', () => {
  const s = session();
  assert.equal(s.result.questions.S02.state, 'pending');
  s.answer('S01', 'none').answer('T01', 'yes');
  assert.equal(s.result.questions.S02.state, 'inactive');
  assert.equal(s.result.questions.S06.state, 'inactive');
  assert.equal(s.result.questions.T03.state, 'inactive');
  assert.equal(s.result.ready_for_review, true);
});

test('multiple children, AND, multi-select routing and cross-tab requirements', () => {
  const s = session().answer('S01', 'partial');
  assert.equal(s.result.questions.S04.state, 'missing');
  assert.equal(s.result.questions.S05.state, 'missing');
  assert.equal(s.result.questions.S06.state, 'pending');
  s.answer('S02', 'yes').answer('S03', ['new', 'shipped']);
  assert.equal(s.result.questions.S06.state, 'missing');
  assert.equal(s.result.questions.S09.state, 'missing');
  assert.equal(s.result.questions.T02.state, 'missing');
  assert.equal(s.result.questions.T03.state, 'pending');
  s.answer('T02', 'async');
  assert.equal(s.result.questions.T03.state, 'missing');
});

test('Other and Undecided remain unresolved and do not select default paths', () => {
  const s = session().special('S01', 'other', 'Only subscriptions can cancel');
  assert.equal(s.result.questions.S01.state, 'other');
  assert.equal(s.result.questions.S02.state, 'pending');
  s.special('S01', 'unknown', 'Product must decide');
  assert.equal(s.result.questions.S01.state, 'unknown');
  assert.equal(s.result.ready_for_review, false);
});

test('parent edits invalidate dependencies, including a change away and back', () => {
  const s = fullBranch();
  assert.equal(s.result.ready_for_review, true);
  const oldS04 = s.response.answers.S04.answer_id;
  s.answer('S01', 'whole');
  assert.equal(s.result.questions.S02.state, 'needs_review');
  assert.equal(s.result.questions.S04.state, 'inactive');
  s.answer('S01', 'partial');
  assert.equal(s.result.questions.S04.state, 'needs_review');
  assert.equal(s.response.answers.S04.answer_id, oldS04);
  s.answer('S02', 'yes');
  assert.equal(s.result.questions.S06.state, 'needs_review');
  assert.equal(s.result.questions.T02.state, 'needs_review');
  s.answer('S04', 'keep').answer('S05', 'keep');
  assert.equal(s.result.questions.T04.state, 'needs_review');
  assert.ok(s.response.history.length > 0);
});

test('numeric zero is answered; out of range and incomplete table are not', () => {
  const s = fullBranch();
  assert.equal(s.result.questions.S06.state, 'answered');
  s.answer('S06', 31);
  assert.equal(s.result.questions.S06.state, 'invalid');
  s.answer('S07', [{role: 'Operator', can_request: 'yes', approval: ''}]);
  assert.equal(s.result.questions.S07.state, 'invalid');
});

test('declared contradiction blocks completion but is not a dependency cycle', () => {
  const s = fullBranch().answer('S08', 'no');
  assert.equal(s.result.conflicts[0].id, 'C01');
  assert.equal(s.result.ready_for_review, false);
});

test('truth handles OR, unknown facts and negation of inactive branches', () => {
  const unknown = () => ({state: 'pending'});
  assert.equal(Core.truth({not: {question:'S01',op:'eq',value:'yes'}}, unknown), null);
  assert.equal(Core.truth({any:[true,{fact:'F01',op:'eq',value:true}]}, unknown), true);
  assert.equal(Core.truth({all:[false,{fact:'F01',op:'eq',value:true}]}, unknown), false);
  const p = Core.clone(original);
  p.questions.push({id:'S10',audience:'spec',owner:'BA',title:'Not on inactive branch',type:'text',when:{not:{question:'S02',op:'eq',value:'yes'}}});
  Core.validatePacket(p);
  const s = session().answer('S01', 'none');
  assert.equal(Core.evaluate(p,s.response.answers).questions.S10.state,'inactive');
});

test('packet validation rejects cycles, invalid option references, malformed operators', () => {
  const cycle = Core.clone(original); cycle.questions[0].requires = ['S02'];
  assert.throws(() => Core.validatePacket(cycle), /cycle/);
  const option = Core.clone(original); option.questions[1].when.value = ['imaginary'];
  assert.throws(() => Core.validatePacket(option), /unknown option/);
  const code = Core.clone(original); code.questions[1].when = 'window.alert(1)';
  assert.throws(() => Core.validatePacket(code), /condition/);
  const rule = Core.clone(original); rule.questions[1].when.op = 'execute';
  assert.throws(() => Core.validatePacket(rule), /operator/);
  const typo = Core.clone(original); typo.questions[1].visibleIf = typo.questions[1].when; delete typo.questions[1].when;
  assert.throws(() => Core.validatePacket(typo), /unknown property visibleIf/);
});

test('packet order can be arbitrary; prerequisites still evaluate first', () => {
  const reversed = Core.clone(packet); reversed.questions.reverse();
  const s = fullBranch();
  assert.equal(Core.evaluate(reversed,s.response.answers).ready_for_review,true);
});

test('merge is atomic and preserves disagreements for explicit choice', () => {
  const a = session().answer('S01','whole'), b = session().answer('S01','partial');
  const before = JSON.stringify(a.response);
  const staged = Core.mergeResponses(packet,a.response,b.response);
  assert.equal(staged.response,null); assert.equal(staged.conflicts.length,1);
  assert.equal(JSON.stringify(a.response),before);
  const merged = Core.mergeResponses(packet,a.response,b.response,{S01:'incoming'}).response;
  assert.equal(merged.answers.S01.value,'partial');
  assert.ok(merged.history.some(h => h.reason === 'merge_not_selected'));
});

test('deleted answers do not silently reappear from an older imported file', () => {
  const s = session().answer('S01','whole');
  const old = Core.clone(s.response); s.clear('S01');
  const result = Core.mergeResponses(packet,s.response,old);
  assert.equal(result.response,null); assert.equal(result.conflicts[0].current,null);
  const keepDeleted = Core.mergeResponses(packet,s.response,old,{S01:'current'}).response;
  assert.equal(keepDeleted.answers.S01,undefined);
  assert.ok(keepDeleted.cleared.S01);
});

test('imports reject incompatible identity and unknown question IDs before mutation', () => {
  const s=fullBranch();
  for (const field of ['packet_id','revision','fingerprint']) {
    const input=Core.clone(s.response); input[field]='different';
    assert.throws(() => Core.validateResponse(packet,input),/different packet or revision/);
  }
  const bad=Core.clone(s.response); bad.answers.BAD=bad.answers.S01;
  assert.throws(() => Core.validateResponse(packet,bad),/not in this packet/);
});

test('merge re-evaluates stale downstream records against the selected parent', () => {
  const s=fullBranch();
  const incoming=Core.updateAnswer(packet,s.response,'S01',{status:'answered',value:'whole',note:''});
  const merged=Core.mergeResponses(packet,s.response,incoming,{S01:'incoming'}).response;
  const result=Core.evaluate(packet,merged.answers);
  assert.equal(result.questions.S02.state,'needs_review');
  assert.equal(result.questions.S04.state,'inactive');
});

test('renderer excludes internal evidence and safely embeds hostile-looking text', () => {
  const p=Core.clone(original); p.internal.secret='PRIVATE_SCOUT_MARKER';
  p.questions[0].internal.secret='PRIVATE_QUESTION_MARKER';
  p.title='</script><script>globalThis.pwned=true</script>';
  const html=render(p);
  assert.ok(html.includes('role="tab"'));
  assert.ok(!html.includes('PRIVATE_SCOUT_MARKER'));
  assert.ok(!html.includes('PRIVATE_QUESTION_MARKER'));
  assert.ok(!html.includes('</script><script>globalThis.pwned=true</script>'));
  assert.ok(html.includes('connect-src \'none\''));
});

test('reconcile excludes inactive and stale answers from effective decisions', () => {
  const s=fullBranch().answer('S01','whole');
  const report=reconcile(original,s.response);
  assert.equal(report.effective_answers.S04,undefined);
  assert.equal(report.effective_answers.S02,undefined);
  assert.equal(report.submitted_answers.S04.value,'keep');
  assert.equal(report.semantic_review_required,true);
  assert.equal(report.effective_answers.S01.answered_by,'Tester');
});

test('public content hash detects same-version content edits; private notes do not change it', () => {
  const privateChange=Core.clone(original); privateChange.internal.extra='another finding';
  assert.equal(documentPacket(privateChange).fingerprint,packet.fingerprint);
  const contentChange=Core.clone(original); contentChange.questions[0].title='A different decision';
  assert.notEqual(documentPacket(contentChange).fingerprint,packet.fingerprint);
});
