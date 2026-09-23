(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GrillCore = factory();
})(globalThis, function () {
  'use strict';

  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const clone = v => JSON.parse(JSON.stringify(v));
  const nonempty = v => typeof v === 'string' && v.trim().length > 0;
  const primitive = v => ['string', 'boolean'].includes(typeof v) || (typeof v === 'number' && Number.isFinite(v));
  const identifier = v => typeof v === 'string' && /^[A-Z][A-Z0-9_]*$/.test(v);
  const safeKey = v => typeof v === 'string' && /^[a-z][a-z0-9_]*$/.test(v) && !['constructor', 'prototype'].includes(v);
  const TYPES = ['single', 'multi', 'text', 'number', 'table'];
  const OPS = ['eq', 'ne', 'in', 'contains', 'gt', 'gte', 'lt', 'lte', 'answered'];
  const INACTIVE = 'inactive-condition';
  const now = () => new Date().toISOString();
  const stamp = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (object(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
    return JSON.stringify(value);
  }

  function refs(condition, kind = 'question') {
    if (!object(condition)) return [];
    if (condition.all || condition.any) return [...new Set((condition.all || condition.any).flatMap(c => refs(c, kind)))];
    if (own(condition, 'not')) return refs(condition.not, kind);
    return condition[kind] ? [condition[kind]] : [];
  }

  function dependencies(q) {
    return [...new Set([...refs(q.when), ...(q.requires || [])])];
  }

  function topological(packet) {
    const byId = new Map(packet.questions.map(q => [q.id, q]));
    const visiting = new Set(), visited = new Set(), result = [];
    function visit(q) {
      if (visiting.has(q.id)) throw new Error(`Dependency cycle at ${q.id}`);
      if (visited.has(q.id)) return;
      visiting.add(q.id);
      for (const id of dependencies(q)) {
        if (!byId.has(id)) throw new Error(`${q.id}: unknown prerequisite ${id}`);
        visit(byId.get(id));
      }
      visiting.delete(q.id); visited.add(q.id); result.push(q);
    }
    packet.questions.forEach(visit);
    return result;
  }

  function validatePacket(packet) {
    const errors = [];
    const check = (ok, message) => { if (!ok) errors.push(message); };
    const keys = (item, allowed, label) => {
      for (const k of Object.keys(item)) check(allowed.includes(k), `${label}: unknown property ${k}; put private metadata in internal`);
    };
    if (!object(packet)) throw new Error('Packet must be an object');
    keys(packet, ['schema_version', 'packet_id', 'revision', 'title', 'intro', 'readiness', 'coverage_note', 'contexts', 'questions', 'constraints', 'internal', 'fingerprint'], 'packet');
    check(packet.schema_version === 1, 'schema_version must be 1');
    check(typeof packet.packet_id === 'string' && /^[a-z][a-z0-9-]*$/.test(packet.packet_id), 'packet_id must be a lowercase slug');
    check(nonempty(packet.revision), 'revision must be a nonempty string');
    check(nonempty(packet.title), 'title is required');
    check(['ready', 'partial'].includes(packet.readiness), 'readiness must be ready or partial');
    for (const key of ['intro', 'coverage_note']) if (own(packet, key)) check(typeof packet[key] === 'string', `${key} must be text`);
    if (packet.readiness === 'partial') check(nonempty(packet.coverage_note), 'partial readiness requires coverage_note');
    if (!Array.isArray(packet.questions) || !packet.questions.length) throw new Error([...errors, 'questions must be a nonempty array'].join('\n'));
    const byId = new Map(), facts = new Map();
    function uniqueId(map, item, label) {
      check(object(item) && identifier(item.id), `${label}: invalid ID`);
      if (!object(item)) return;
      check(!map.has(item.id), `${label}: duplicate ID ${item.id}`);
      map.set(item.id, item);
    }
    if (own(packet, 'contexts')) check(Array.isArray(packet.contexts), 'contexts must be an array');
    for (const f of Array.isArray(packet.contexts) ? packet.contexts : []) {
      uniqueId(facts, f, 'context');
      if (!object(f)) continue;
      keys(f, ['id', 'label', 'status', 'value', 'internal'], f.id);
      check(nonempty(f.label), `${f.id}: context label required`);
      check(['confirmed', 'unknown'].includes(f.status), `${f.id}: invalid context status`);
      if (f.status === 'confirmed') check(primitive(f.value) || (Array.isArray(f.value) && f.value.every(primitive)), `${f.id}: confirmed context needs a scalar or scalar array`);
      if (f.status === 'unknown') check(!own(f, 'value'), `${f.id}: unknown context must omit value`);
    }
    function validateOptions(item, label) {
      check(Array.isArray(item.options) && item.options.length > 0, `${label}: options required`);
      const seen = new Set();
      for (const opt of Array.isArray(item.options) ? item.options : []) {
        check(object(opt) && nonempty(opt.value) && nonempty(opt.label), `${label}: options need string value and label`);
        if (!object(opt)) continue;
        keys(opt, ['value', 'label', 'detail', 'internal'], label);
        check(!seen.has(opt.value), `${label}: duplicate option ${opt.value}`); seen.add(opt.value);
        if (own(opt, 'detail')) check(typeof opt.detail === 'string', `${label}: option detail must be text`);
      }
    }
    for (const q of packet.questions) {
      uniqueId(byId, q, 'question');
      if (!object(q)) continue;
      keys(q, ['id', 'audience', 'owner', 'title', 'section', 'context', 'why', 'recommendation', 'type', 'required', 'allow_other', 'options', 'columns', 'when', 'requires', 'min', 'max', 'unit', 'internal'], q.id);
      check(!facts.has(q.id), `${q.id}: question and context IDs overlap`);
      check(['spec', 'tech'].includes(q.audience), `${q.id}: audience must be spec or tech`);
      check(nonempty(q.title), `${q.id}: title required`);
      check(nonempty(q.owner), `${q.id}: owner required`);
      check(TYPES.includes(q.type), `${q.id}: unsupported type`);
      for (const k of ['context', 'why', 'section', 'recommendation', 'unit']) if (own(q, k)) check(typeof q[k] === 'string', `${q.id}: ${k} must be text`);
      for (const k of ['required', 'allow_other']) if (own(q, k)) check(typeof q[k] === 'boolean', `${q.id}: ${k} must be boolean`);
      if (own(q, 'requires')) check(Array.isArray(q.requires) && q.requires.every(identifier), `${q.id}: requires must contain question IDs`);
      if (['single', 'multi'].includes(q.type)) validateOptions(q, q.id);
      if (own(q, 'options')) check(['single', 'multi'].includes(q.type), `${q.id}: options only apply to choice questions`);
      if (own(q, 'columns')) check(q.type === 'table', `${q.id}: columns only apply to tables`);
      for (const k of ['min', 'max']) if (own(q, k)) check(q.type === 'number' && typeof q[k] === 'number' && Number.isFinite(q[k]), `${q.id}: ${k} needs a numeric question and finite value`);
      if (own(q, 'min') && own(q, 'max')) check(q.min <= q.max, `${q.id}: min exceeds max`);
      if (q.type === 'table') {
        check(Array.isArray(q.columns) && q.columns.length > 0, `${q.id}: table columns required`);
        const cols = new Set();
        for (const col of Array.isArray(q.columns) ? q.columns : []) {
          if (!object(col)) { errors.push(`${q.id}: invalid column`); continue; }
          keys(col, ['key', 'label', 'type', 'required', 'options', 'internal'], `${q.id}.${col.key}`);
          check(safeKey(col.key) && !cols.has(col.key), `${q.id}: invalid or duplicate column key`); cols.add(col.key);
          check(nonempty(col.label), `${q.id}: column label required`);
          check(['text', 'number', 'single', 'multi'].includes(col.type), `${q.id}: unsupported column type`);
          if (own(col, 'required')) check(typeof col.required === 'boolean', `${q.id}: column required must be boolean`);
          if (['single', 'multi'].includes(col.type)) validateOptions(col, `${q.id}.${col.key}`);
        }
      }
    }
    function condition(c, label) {
      if (typeof c === 'boolean') return;
      if (!object(c)) { errors.push(`${label}: invalid condition`); return; }
      const keys = Object.keys(c);
      if (own(c, 'all') || own(c, 'any')) {
        check(keys.length === 1, `${label}: use one condition combinator`);
        const items = c.all || c.any;
        check(Array.isArray(items) && items.length > 0, `${label}: all/any requires nonempty array`);
        if (Array.isArray(items)) items.forEach(x => condition(x, label));
        return;
      }
      if (own(c, 'not')) { check(keys.length === 1, `${label}: not must stand alone`); condition(c.not, label); return; }
      check(keys.every(k => ['question', 'fact', 'op', 'value'].includes(k)), `${label}: unknown condition property`);
      check(own(c, 'question') !== own(c, 'fact'), `${label}: choose question or fact`);
      const target = own(c, 'question') ? byId.get(c.question) : facts.get(c.fact);
      check(!!target, `${label}: unknown reference ${c.question || c.fact}`);
      check(OPS.includes(c.op), `${label}: unknown operator ${c.op}`);
      if (c.op === 'answered') { check(!own(c, 'value'), `${label}: answered omits value`); return; }
      check(own(c, 'value'), `${label}: operator needs value`);
      if (c.op === 'in') check(Array.isArray(c.value) && c.value.length > 0 && c.value.every(primitive), `${label}: in needs a scalar array`);
      else check(primitive(c.value), `${label}: operator needs a scalar value`);
      if (['gt', 'gte', 'lt', 'lte'].includes(c.op)) {
        check(typeof c.value === 'number', `${label}: numeric comparison requires number`);
        if (own(c, 'question') && target) check(target.type === 'number', `${label}: numeric comparison on non-number`);
      }
      if (own(c, 'question') && target) {
        if (target.type === 'table') check(c.op === 'answered', `${label}: tables support answered only`);
        if (target.type === 'multi') check(c.op === 'contains', `${label}: multi-choice uses contains or answered`);
        if (c.op === 'contains') check(target.type === 'multi', `${label}: contains needs multi-choice question`);
        if (['single', 'multi'].includes(target.type)) {
          const allowed = new Set((target.options || []).map(o => o.value));
          const values = c.op === 'in' && Array.isArray(c.value) ? c.value : [c.value];
          check(values.every(v => allowed.has(v)), `${label}: condition references an unknown option on ${target.id}`);
        }
      }
    }
    for (const q of packet.questions.filter(object)) {
      if (own(q, 'when')) condition(q.when, q.id);
      for (const id of Array.isArray(q.requires) ? q.requires : []) check(byId.has(id), `${q.id}: unknown prerequisite ${id}`);
    }
    if (own(packet, 'constraints')) check(Array.isArray(packet.constraints), 'constraints must be an array');
    const ruleIds = new Set();
    for (const r of Array.isArray(packet.constraints) ? packet.constraints : []) {
      if (!object(r)) { errors.push('Invalid constraint'); continue; }
      keys(r, ['id', 'when', 'message', 'internal'], r.id);
      check(identifier(r.id) && !ruleIds.has(r.id), 'Invalid or duplicate constraint ID'); ruleIds.add(r.id);
      check(nonempty(r.message), `${r.id}: constraint message required`);
      condition(r.when, r.id);
    }
    if (!errors.length) { try { topological(packet); } catch (e) { errors.push(e.message); } }
    if (errors.length) throw new Error(errors.join('\n'));
    return packet;
  }

  function publicPacket(packet) {
    validatePacket(packet);
    const pick = (o, keys) => Object.fromEntries(keys.filter(k => own(o, k)).map(k => [k, clone(o[k])]));
    const result = pick(packet, ['schema_version', 'packet_id', 'revision', 'title', 'intro', 'coverage_note', 'readiness']);
    result.questions = packet.questions.map(q => {
      const v = pick(q, ['id', 'audience', 'owner', 'title', 'section', 'context', 'why', 'recommendation', 'type', 'required', 'allow_other', 'when', 'requires', 'min', 'max', 'unit']);
      if (q.options) v.options = q.options.map(o => pick(o, ['value', 'label', 'detail']));
      if (q.columns) v.columns = q.columns.map(c => {
        const col = pick(c, ['key', 'label', 'type', 'required']);
        if (c.options) col.options = c.options.map(o => pick(o, ['value', 'label', 'detail']));
        return col;
      });
      return v;
    });
    result.contexts = (packet.contexts || []).map(f => pick(f, ['id', 'label', 'status', 'value']));
    result.constraints = (packet.constraints || []).map(c => pick(c, ['id', 'when', 'message']));
    return result;
  }

  function truth(condition, resolve) {
    if (condition === undefined) return true;
    if (typeof condition === 'boolean') return condition;
    if (condition.all) {
      const values = condition.all.map(x => truth(x, resolve));
      return values.includes(false) ? false : values.includes(INACTIVE) ? INACTIVE : values.includes(null) ? null : true;
    }
    if (condition.any) {
      const values = condition.any.map(x => truth(x, resolve));
      return values.includes(true) ? true : values.includes(null) ? null : values.includes(INACTIVE) ? INACTIVE : false;
    }
    if (own(condition, 'not')) { const v = truth(condition.not, resolve); return v === null || v === INACTIVE ? v : !v; }
    const resolved = resolve(condition.question ? 'question' : 'fact', condition.question || condition.fact);
    if (resolved.state === 'inactive') return INACTIVE;
    if (resolved.state !== 'known') return null;
    const a = resolved.value, b = condition.value;
    switch (condition.op) {
      case 'answered': return true;
      case 'eq': return a === b;
      case 'ne': return a !== b;
      case 'in': return Array.isArray(b) && b.includes(a);
      case 'contains': return Array.isArray(a) && a.includes(b);
      case 'gt': return typeof a === 'number' && a > b;
      case 'gte': return typeof a === 'number' && a >= b;
      case 'lt': return typeof a === 'number' && a < b;
      case 'lte': return typeof a === 'number' && a <= b;
      default: throw new Error('Unknown condition operator');
    }
  }

  function valueErrors(field, value, partial = false) {
    const errors = [];
    const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);
    if (empty) return partial || field.required === false ? [] : ['An answer is required.'];
    if (field.type === 'text' && (typeof value !== 'string' || !value.trim())) errors.push('Enter some text.');
    if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) errors.push('Enter a valid number.');
      else {
        if (!partial && own(field, 'min') && value < field.min) errors.push(`Minimum value: ${field.min}.`);
        if (!partial && own(field, 'max') && value > field.max) errors.push(`Maximum value: ${field.max}.`);
      }
    }
    const options = new Set((field.options || []).map(o => o.value));
    if (field.type === 'single' && !options.has(value)) errors.push('This choice is not available for the question.');
    if (field.type === 'multi' && (!Array.isArray(value) || value.some(v => !options.has(v)) || new Set(value).size !== value.length)) errors.push('The selected options are invalid.');
    if (field.type === 'table') {
      if (!Array.isArray(value)) return ['The response table is invalid.'];
      const keys = new Set(field.columns.map(c => c.key));
      value.forEach((row, i) => {
        if (!object(row) || Object.keys(row).some(k => !keys.has(k))) { errors.push(`Row ${i + 1}: invalid column.`); return; }
        for (const col of field.columns) for (const e of valueErrors(col, row[col.key], partial)) errors.push(`Row ${i + 1}, ${col.label}: ${e}`);
      });
    }
    return errors;
  }

  function entryErrors(q, answer, partial = false) {
    if (!object(answer) || !['answered', 'other', 'unknown'].includes(answer.status)) return ['The response status is invalid.'];
    const errors = [];
    if (own(answer, 'note') && typeof answer.note !== 'string') errors.push('The note must be text.');
    if (own(answer, 'answered_by') && typeof answer.answered_by !== 'string') errors.push('The respondent name must be text.');
    if (answer.status === 'answered') errors.push(...valueErrors({...q, required: true}, answer.value, partial));
    else {
      if (own(answer, 'value')) errors.push('Other and Undecided responses must use a note instead of a value.');
      if (answer.status === 'other' && q.allow_other === false) errors.push('This question does not allow an Other response.');
      if (!partial && !nonempty(answer.note)) errors.push(answer.status === 'other' ? 'Describe the other rule and give an example.' : 'Describe what is missing or who can confirm it.');
    }
    return errors;
  }

  function expectedBasis(q, answers) {
    return Object.fromEntries(dependencies(q).map(id => [id, answers[id]?.answer_id || null]));
  }

  function evaluate(packet, answers = {}) {
    const states = {}, contexts = new Map((packet.contexts || []).map(f => [f.id, f]));
    function resolve(kind, id) {
      if (kind === 'fact') { const f = contexts.get(id); return f?.status === 'confirmed' ? {state: 'known', value: f.value} : {state: 'pending'}; }
      const s = states[id];
      if (s?.state === 'inactive') return {state: 'inactive'};
      return s?.state === 'answered' ? {state: 'known', value: answers[id].value} : {state: 'pending'};
    }
    for (const q of topological(packet)) {
      let applicability = truth(q.when, resolve);
      if (applicability === INACTIVE) applicability = false;
      for (const dep of q.requires || []) {
        if (states[dep]?.state === 'inactive') applicability = false;
        else if (states[dep]?.state !== 'answered' && applicability !== false) applicability = null;
      }
      let state, errors = [];
      const answer = answers[q.id];
      if (applicability === false) state = 'inactive';
      else if (applicability === null) state = 'pending';
      else if (!answer) state = q.required === false ? 'optional' : 'missing';
      else {
        errors = entryErrors(q, answer);
        if (errors.length) state = 'invalid';
        else if (canonical(answer.basis || {}) !== canonical(expectedBasis(q, answers))) state = 'needs_review';
        else state = answer.status;
      }
      states[q.id] = {state, applicability, errors};
    }
    const conflicts = [], pending_constraints = [];
    for (const rule of packet.constraints || []) {
      const active = truth(rule.when, resolve);
      if (active === true) conflicts.push({id: rule.id, message: rule.message, questions: refs(rule.when)});
      if (active === null) pending_constraints.push(rule.id);
    }
    const counts = {};
    for (const s of Object.values(states)) counts[s.state] = (counts[s.state] || 0) + 1;
    const open = packet.questions.filter(q => !['answered', 'inactive', 'optional'].includes(states[q.id].state)).map(q => q.id);
    return {questions: states, conflicts, pending_constraints, counts, open,
      ready_for_review: open.length === 0 && conflicts.length === 0 && pending_constraints.length === 0 && packet.readiness === 'ready'};
  }

  function blankResponse(packet) {
    return {schema_version: 1, packet_id: packet.packet_id, revision: packet.revision,
      fingerprint: packet.fingerprint, exported_at: now(), respondent: '', answers: {}, cleared: {}, history: []};
  }

  function validateResponse(packet, data) {
    if (!object(data) || data.schema_version !== 1) throw new Error('The response file has an invalid format.');
    if (data.packet_id !== packet.packet_id || data.revision !== packet.revision || data.fingerprint !== packet.fingerprint) throw new Error('The response file belongs to a different packet or revision. Open the matching HTML file; an agent must reconcile changes across revisions.');
    if (!object(data.answers) || !Array.isArray(data.history) || typeof data.respondent !== 'string') throw new Error('The response file is missing required data.');
    const byId = new Map(packet.questions.map(q => [q.id, q]));
    function checkAnswer(id, answer) {
      const q = byId.get(id);
      if (!q) throw new Error(`Question ${id} is not in this packet.`);
      const errors = entryErrors(q, answer, true);
      if (!object(answer) || !nonempty(answer.answer_id) || !nonempty(answer.updated_at) || !object(answer.basis)) errors.push('Answer record metadata is missing.');
      if (object(answer?.basis)) for (const [dep, value] of Object.entries(answer.basis)) {
        if (!dependencies(q).includes(dep) || !(value === null || nonempty(value))) errors.push('The answer dependency context is invalid.');
      }
      if (errors.length) throw new Error(`${id}: ${errors.join(' ')}`);
    }
    for (const [id, a] of Object.entries(data.answers)) checkAnswer(id, a);
    if (data.cleared !== undefined && !object(data.cleared)) throw new Error('Cleared-answer data is invalid.');
    for (const [id, marker] of Object.entries(data.cleared || {})) {
      if (!byId.has(id) || own(data.answers, id) || !object(marker) || !nonempty(marker.answer_id) || !nonempty(marker.updated_at)) throw new Error('Cleared-answer data is invalid.');
    }
    for (const h of data.history) {
      if (!object(h) || !nonempty(h.at) || !nonempty(h.reason)) throw new Error('Answer history is invalid.');
      checkAnswer(h.question_id, h.answer);
    }
    return clone(data);
  }

  function updateAnswer(packet, response, id, entry) {
    const q = packet.questions.find(x => x.id === id);
    if (!q) throw new Error('Unknown question');
    const result = clone(response);
    result.cleared ||= {};
    if (entry) {
      const errors = entryErrors(q, entry, true);
      if (errors.length) throw new Error(errors.join(' '));
      const previous = result.answers[id];
      const payload = a => ({status: a.status, ...(own(a, 'value') ? {value: a.value} : {}), note: a.note || '', answered_by: a.answered_by || ''});
      const basis = expectedBasis(q, result.answers);
      if (previous && canonical(payload(previous)) === canonical(payload(entry)) && canonical(previous.basis) === canonical(basis)) return result;
      if (previous) result.history.push({question_id: id, answer: previous, reason: 'edited', at: now()});
      result.answers[id] = {...payload(entry), answer_id: stamp(), updated_at: now(), basis};
      delete result.cleared[id];
    } else {
      if (!result.answers[id]) return result;
      result.history.push({question_id: id, answer: result.answers[id], reason: 'cleared', at: now()});
      delete result.answers[id];
      result.cleared[id] = {answer_id: stamp(), updated_at: now()};
    }
    // Retain downstream answers, but their recorded basis now differs. The form
    // asks for explicit reconfirmation; stale values never drive further routing.
    result.exported_at = now();
    return result;
  }

  function mergeResponses(packet, current, incoming, resolutions = {}) {
    validateResponse(packet, current); validateResponse(packet, incoming);
    const result = clone(current), conflicts = [];
    result.cleared ||= {};
    const signature = a => canonical({status: a.status, value: a.value, note: a.note || '', basis: a.basis, answer_id: a.answer_id});
    for (const q of topological(packet)) {
      const a = current.answers[q.id], b = incoming.answers[q.id];
      const ac = current.cleared?.[q.id], bc = incoming.cleared?.[q.id];
      if (!b && !bc) continue;
      const assign = useIncoming => {
        const value = useIncoming ? b : a, marker = useIncoming ? bc : ac;
        delete result.answers[q.id]; delete result.cleared[q.id];
        if (value) result.answers[q.id] = clone(value);
        if (marker) result.cleared[q.id] = clone(marker);
      };
      if (!a && !ac) { assign(true); continue; }
      if ((a && b && signature(a) === signature(b)) || (ac && bc && canonical(ac) === canonical(bc))) continue;
      const choice = resolutions[q.id];
      if (!['current', 'incoming'].includes(choice)) { conflicts.push({id: q.id, current: a || null, incoming: b || null}); continue; }
      assign(choice === 'incoming');
      const discarded = choice === 'current' ? b : a;
      if (discarded) result.history.push({question_id: q.id, answer: clone(discarded), reason: 'merge_not_selected', at: now()});
    }
    if (conflicts.length) return {response: null, conflicts};
    const history = [...result.history, ...incoming.history];
    result.history = [...new Map(history.map(h => [canonical(h), h])).values()];
    result.exported_at = now();
    return {response: result, conflicts: []};
  }

  function describe(packet, condition) {
    if (condition === undefined || condition === true) return 'Always applies';
    if (condition === false) return 'Does not apply in this revision';
    if (condition.all || condition.any) return '(' + (condition.all || condition.any).map(c => describe(packet, c)).join(condition.all ? ' AND ' : ' OR ') + ')';
    if (own(condition, 'not')) return 'Not satisfied: ' + describe(packet, condition.not);
    const q = packet.questions.find(x => x.id === condition.question);
    const f = (packet.contexts || []).find(x => x.id === condition.fact);
    const label = q ? q.id : f?.label || condition.fact;
    const valueLabel = value => q?.options?.find(o => o.value === value)?.label || String(value);
    const op = {eq: 'is', ne: 'is not', in: 'is one of', contains: 'includes', gt: 'greater than', gte: 'at least', lt: 'less than', lte: 'at most', answered: 'has been answered'}[condition.op];
    return `${label} ${op}${condition.op === 'answered' ? '' : ' ' + (Array.isArray(condition.value) ? condition.value.map(valueLabel).join(' / ') : valueLabel(condition.value))}`;
  }

  return {canonical, clone, refs, dependencies, topological, validatePacket, publicPacket,
    truth, evaluate, valueErrors, entryErrors, expectedBasis, blankResponse,
    validateResponse, updateAnswer, mergeResponses, describe};
});
