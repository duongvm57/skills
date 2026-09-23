(function () {
  'use strict';
  const Core = window.GrillCore;
  const packet = JSON.parse(document.getElementById('packet-data').textContent);
  const $ = id => document.getElementById(id);
  const el = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const labels = {answered: 'Answered', missing: 'Needs an answer', optional: 'Optional', pending: 'Waiting for an earlier answer', inactive: 'Not applicable', other: 'Other rule', unknown: 'Undecided', invalid: 'Needs correction', needs_review: 'Needs reconfirmation'};
  const storageKey = `grill:${packet.packet_id}:${packet.revision}:${packet.fingerprint}`;
  let response = Core.blankResponse(packet), evaluation, activeTab = 'spec', storageOK = true, pendingImport;
  const cards = new Map();

  function notice(text, kind = 'error') {
    $('notice').textContent = text; $('notice').dataset.kind = kind; $('notice').hidden = false;
  }

  function save() {
    response.respondent = $('respondent').value;
    try { localStorage.setItem(storageKey, JSON.stringify(response)); storageOK = true; }
    catch (_) { storageOK = false; }
    $('save-status').textContent = storageOK ? 'Draft saved in this browser.' : 'Could not save in this browser. Export your answers to keep this draft.';
  }

  function selectTab(tab, focus = false) {
    activeTab = tab;
    for (const role of ['spec', 'tech']) {
      $('panel-' + role).hidden = role !== tab;
      $('tab-' + role).setAttribute('aria-selected', String(role === tab));
      $('tab-' + role).tabIndex = role === tab ? 0 : -1;
    }
    if (focus) $('tab-' + tab).focus();
  }

  function jump(id) {
    const q = packet.questions.find(x => x.id === id);
    if (!q) return;
    selectTab(q.audience);
    const card = cards.get(id).article;
    card.scrollIntoView({block: 'center', behavior: 'auto'}); card.focus({preventScroll: true});
  }

  function summarize(q, a) {
    if (!a) return 'Answer cleared';
    if (a.status !== 'answered') return `${labels[a.status]}: ${a.note || '(no details provided)'}`;
    const opt = v => q.options?.find(o => o.value === v)?.label || String(v);
    let value;
    if (q.type === 'table') value = (a.value || []).map(row => q.columns.map(c => {
      const raw = row[c.key];
      const show = v => c.options?.find(o => o.value === v)?.label || String(v ?? '');
      return `${c.label}: ${Array.isArray(raw) ? raw.map(show).join(', ') : show(raw)}`;
    }).join(' · ')).join('\n');
    else value = Array.isArray(a.value) ? a.value.map(opt).join(', ') : opt(a.value ?? '');
    return value + (a.note ? '\nNote: ' + a.note : '');
  }

  function makeQuestion(q) {
    const article = el('article', undefined, 'question'); article.id = 'question-' + q.id; article.tabIndex = -1;
    const head = el('div', undefined, 'question-head'); head.append(el('span', q.id, 'question-id'));
    const badge = el('span', '', 'badge'); head.append(badge); article.append(head, el('h3', q.title));
    article.append(el('p', `Decision owner: ${q.owner}${q.required === false ? ' · Optional' : ''}`, 'owner'));
    const context = el('p', q.context || '', 'question-context'); context.hidden = !q.context; article.append(context);
    if (q.when !== undefined || q.requires?.length) {
      const condition = el('div', undefined, 'condition');
      const parts = [];
      if (q.when !== undefined) parts.push(Core.describe(packet, q.when));
      if (q.requires?.length) parts.push('Requires answers: ' + q.requires.join(', '));
      condition.append(el('span', 'Answer when: ' + parts.join(' · ')));
      for (const id of Core.dependencies(q)) {
        const button = el('button', 'View ' + id); button.type = 'button'; button.addEventListener('click', () => jump(id)); condition.append(button);
      }
      article.append(condition);
    }
    const pending = el('p', '', 'pending-message'); article.append(pending);
    const fieldset = el('fieldset'); fieldset.setAttribute('aria-label', 'Answer ' + q.id);
    const modeRow = el('div', undefined, 'mode-row');
    const modeLabel = el('label', 'Response type');
    const mode = el('select'); mode.id = 'mode-' + q.id; mode.setAttribute('aria-label', `${q.id} Response type`);
    for (const [value, text] of [['answered', 'Answer'], ...(q.allow_other === false ? [] : [['other', 'Other rule']]), ['unknown', 'Undecided']]) {
      const option = el('option', text); option.value = value; mode.append(option);
    }
    modeLabel.append(mode); modeRow.append(modeLabel);
    const clear = el('button', 'Clear answer', 'clear-button'); clear.type = 'button'; modeRow.append(clear); fieldset.append(modeRow);
    const fields = el('div'); fields.id = 'fields-' + q.id; fieldset.append(fields);
    const noteLabel = el('label', 'Notes / exceptions (if any)', 'note-label'); noteLabel.htmlFor = 'note-' + q.id;
    const note = el('textarea', undefined, 'answer-note'); note.id = 'note-' + q.id; note.rows = 2;
    fieldset.append(noteLabel, note);
    const review = el('div', undefined, 'reconfirm'); review.append(el('div', 'An earlier answer changed. Review this response before using it again.'));
    const confirm = el('button', 'Confirm this answer again', 'secondary'); confirm.type = 'button'; review.append(confirm); fieldset.prepend(review);
    const errors = el('div', '', 'errors'); errors.setAttribute('aria-live', 'polite'); fieldset.append(errors); article.append(fieldset);
    if (q.why || q.recommendation) {
      const details = el('details', undefined, 'details'); details.append(el('summary', 'Decision context'));
      if (q.why) details.append(el('p', q.why));
      if (q.recommendation) details.append(el('p', 'Suggestion to consider: ' + q.recommendation));
      article.append(details);
    }
    const card = {q, article, badge, context, pending, fieldset, mode, fields, note, noteLabel, review, errors};
    cards.set(q.id, card);

    function tableCell(col, value, rowNumber) {
      let control;
      if (['single', 'multi'].includes(col.type)) {
        control = el('select'); control.multiple = col.type === 'multi';
        if (col.type === 'single') { const empty = el('option', 'Choose…'); empty.value = ''; control.append(empty); }
        for (const o of col.options) {
          const option = el('option', o.label); option.value = o.value;
          option.selected = col.type === 'multi' ? (value || []).includes(o.value) : value === o.value;
          control.append(option);
        }
      } else {
        control = el('input'); control.type = col.type === 'number' ? 'number' : 'text'; control.value = value ?? '';
        if (col.type === 'number') control.step = 'any';
      }
      control.dataset.column = col.key; control.setAttribute('aria-label', `${q.id} Row ${rowNumber} ${col.label}`);
      control.addEventListener(col.type === 'single' || col.type === 'multi' ? 'change' : 'input', commit);
      return control;
    }

    function tableRow(row, body) {
      const tr = el('tr'); tr.className = 'answer-row';
      const rowNumber = body.children.length + 1;
      for (const col of q.columns) { const td = el('td'); td.append(tableCell(col, row[col.key], rowNumber)); tr.append(td); }
      const action = el('td'); const remove = el('button', 'Remove'); remove.type = 'button'; remove.setAttribute('aria-label', `${q.id} Remove row ${rowNumber}`);
      remove.addEventListener('click', () => {
        tr.remove();
        [...body.children].forEach((r, i) => {
          q.columns.forEach(col => r.querySelector(`[data-column="${col.key}"]`).setAttribute('aria-label', `${q.id} Row ${i + 1} ${col.label}`));
          r.querySelector('button').setAttribute('aria-label', `${q.id} Remove row ${i + 1}`);
        });
        commit();
      });
      action.append(remove); tr.append(action); body.append(tr);
    }

    function fillFields(value) {
      fields.replaceChildren();
      if (q.type === 'single' || q.type === 'multi') {
        const options = el('div', undefined, 'options');
        for (const o of q.options) {
          const label = el('label', undefined, 'option');
          const input = el('input'); input.type = q.type === 'single' ? 'radio' : 'checkbox'; input.name = q.id; input.value = o.value;
          input.checked = q.type === 'single' ? value === o.value : Array.isArray(value) && value.includes(o.value);
          input.addEventListener('change', commit);
          const text = el('span', o.label, 'option-text'); if (o.detail) text.append(el('small', o.detail, 'option-detail'));
          label.append(input, text); options.append(label);
        }
        fields.append(options);
      } else if (q.type === 'table') {
        const scroll = el('div', undefined, 'table-scroll'), table = el('table'), thead = el('thead'), heading = el('tr'), body = el('tbody');
        q.columns.forEach(col => heading.append(el('th', col.label))); heading.append(el('th', '')); thead.append(heading); table.append(thead, body); scroll.append(table); fields.append(scroll);
        for (const row of Array.isArray(value) ? value : []) tableRow(row, body);
        const add = el('button', '+ Add row', 'table-add'); add.type = 'button'; add.setAttribute('aria-label', `${q.id} Add row`);
        add.addEventListener('click', () => { tableRow({}, body); commit(); body.lastElementChild.querySelector('input,select')?.focus(); }); fields.append(add);
      } else {
        const control = el(q.type === 'text' ? 'textarea' : 'input', undefined, 'answer-input');
        control.setAttribute('aria-label', q.id + ' Answer');
        if (q.type === 'number') {
          control.type = 'number'; control.step = 'any';
          if (q.min !== undefined) control.min = q.min;
          if (q.max !== undefined) control.max = q.max;
        }
        control.value = value ?? ''; control.addEventListener('input', commit); fields.append(control);
        if (q.unit) fields.append(el('span', q.unit, 'unit'));
      }
    }

    function readValue() {
      if (q.type === 'single') return fields.querySelector('input:checked')?.value || '';
      if (q.type === 'multi') return [...fields.querySelectorAll('input:checked')].map(x => x.value);
      if (q.type === 'table') return [...fields.querySelectorAll('.answer-row')].map(row => Object.fromEntries(q.columns.map(col => {
        const field = row.querySelector(`[data-column="${col.key}"]`);
        const value = col.type === 'multi' ? [...field.selectedOptions].map(o => o.value) : col.type === 'number' ? (field.value === '' ? null : Number(field.value)) : field.value;
        return [col.key, value];
      })));
      const input = fields.querySelector('input,textarea');
      return q.type === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value;
    }

    function commit() {
      try {
        const entry = {status: mode.value, note: note.value, answered_by: $('respondent').value.trim()};
        if (mode.value === 'answered') entry.value = readValue();
        const empty = entry.value === '' || entry.value === null || (Array.isArray(entry.value) && !entry.value.length);
        response = Core.updateAnswer(packet, response, q.id, mode.value === 'answered' && empty && !entry.note ? null : entry);
        sync(); save();
      } catch (e) { notice(e.message); }
    }

    function restore() {
      const answer = response.answers[q.id]; mode.value = answer?.status || 'answered'; note.value = answer?.note || ''; fillFields(answer?.value);
    }
    mode.addEventListener('change', commit); note.addEventListener('input', commit); confirm.addEventListener('click', commit);
    clear.addEventListener('click', () => { response = Core.updateAnswer(packet, response, q.id, null); restore(); sync(); save(); });
    card.restore = restore; restore(); return article;
  }

  function sync() {
    evaluation = Core.evaluate(packet, response.answers);
    for (const [id, card] of cards) {
      const s = evaluation.questions[id];
      card.article.hidden = s.state === 'inactive'; card.article.dataset.state = s.state;
      card.badge.textContent = labels[s.state]; card.badge.dataset.state = s.state;
      card.fieldset.hidden = s.state === 'pending'; card.pending.hidden = s.state !== 'pending';
      card.context.hidden = !card.q.context || s.state === 'pending';
      const blockers = Core.dependencies(card.q).filter(dep => evaluation.questions[dep].state !== 'answered').map(dep => {
        const q = packet.questions.find(x => x.id === dep); return `${dep} (${q.audience === 'spec' ? 'BA' : 'DEV'})`;
      });
      card.pending.textContent = blockers.length ? 'Clarify ' + blockers.join(', ') + ' to determine whether this question applies.' : 'Verify the missing information before answering this question.';
      card.fields.hidden = card.mode.value !== 'answered';
      card.noteLabel.textContent = card.mode.value === 'other' ? 'Describe the rule, exception, and an example' : card.mode.value === 'unknown' ? 'What is missing / who can confirm it' : 'Notes / exceptions (if any)';
      card.review.hidden = s.state !== 'needs_review';
      card.errors.textContent = s.errors.join('\n'); card.errors.hidden = !s.errors.length;
    }
    const relevant = packet.questions.filter(q => evaluation.questions[q.id].applicability === true && (q.required !== false || response.answers[q.id]));
    const answered = relevant.filter(q => evaluation.questions[q.id].state === 'answered').length;
    $('progress-text').textContent = `${answered} / ${relevant.length} applicable questions answered`;
    $('progress').max = Math.max(1, relevant.length); $('progress').value = answered;
    $('overall-status').textContent = evaluation.ready_for_review ? 'Ready for agent review. Decisions still need to be checked against the requirements.' : `${evaluation.open.length} questions still need an answer, confirmation, or clarification${evaluation.conflicts.length ? `; ${evaluation.conflicts.length} conflicts` : ''}.${packet.readiness === 'partial' ? ' Investigation coverage is limited.' : ''}`;
    $('sidebar-counts').replaceChildren();
    for (const [label, count] of [['Waiting for a condition', evaluation.counts.pending || 0], ['Needs reconfirmation', evaluation.counts.needs_review || 0], ['Undecided / other', (evaluation.counts.unknown || 0) + (evaluation.counts.other || 0)], ['Not applicable', evaluation.counts.inactive || 0]]) {
      const row = el('div', undefined, 'count-row'); row.append(el('span', label), el('strong', String(count))); $('sidebar-counts').append(row);
    }
    for (const role of ['spec', 'tech']) {
      const qs = packet.questions.filter(q => q.audience === role && evaluation.questions[q.id].state !== 'inactive');
      $('count-' + role).textContent = `${qs.filter(q => evaluation.questions[q.id].state === 'answered').length}/${qs.length}`;
      const empty = $('empty-' + role); if (empty) empty.hidden = qs.length > 0;
    }
    $('conflicts').replaceChildren(); $('conflicts').hidden = !evaluation.conflicts.length;
    if (evaluation.conflicts.length) $('conflicts').append(el('strong', 'Answers need reconciliation'));
    for (const conflict of evaluation.conflicts) {
      const p = el('p', conflict.message + ' ');
      for (const id of conflict.questions) { const b = el('button', id, 'clear-button'); b.addEventListener('click', () => jump(id)); p.append(b); }
      $('conflicts').append(p);
    }
    $('history-count').textContent = `(${response.history.length})`;
    if ($('history').parentElement.open) renderHistory();
  }

  function renderHistory() {
    $('history').replaceChildren();
    if (!response.history.length) { $('history').append(el('p', 'No changes yet.')); return; }
    for (const item of response.history.slice().reverse()) {
      const q = packet.questions.find(x => x.id === item.question_id);
      const div = el('div', undefined, 'history-entry');
      div.append(el('strong', item.question_id), el('p', summarize(q, item.answer)), el('p', new Date(item.at).toLocaleString('en-GB'), 'muted'));
      $('history').append(div);
    }
  }

  function finishImport(merged) {
    response = merged;
    for (const card of cards.values()) card.restore();
    sync(); save();
    notice('Answers imported and reconciled. Review questions marked for reconfirmation.', 'success');
  }

  function startImport(incoming) {
    const checked = Core.validateResponse(packet, incoming);
    const result = Core.mergeResponses(packet, response, checked);
    if (result.response) { finishImport(result.response); return; }
    pendingImport = checked; $('merge-items').replaceChildren(); $('merge-error').textContent = '';
    for (const conflict of result.conflicts) {
      const q = packet.questions.find(x => x.id === conflict.id);
      const section = el('section', undefined, 'merge-item'); section.dataset.question = q.id;
      section.append(el('strong', `${q.id} — ${q.title}`));
      for (const [value, label, answer] of [['current', 'Current copy', conflict.current], ['incoming', 'Imported copy', conflict.incoming]]) {
        const choice = el('label'), input = el('input'); input.type = 'radio'; input.name = 'merge-' + q.id; input.value = value;
        const content = el('div'); content.append(el('strong', label), el('pre', summarize(q, answer)));
        if (answer) content.append(el('small', `Respondent: ${answer.answered_by || 'Name not provided'} · ${new Date(answer.updated_at).toLocaleString('en-GB')}`));
        choice.append(input, content); section.append(choice);
      }
      $('merge-items').append(section);
    }
    $('merge-dialog').showModal();
  }

  $('title').textContent = packet.title; $('intro').textContent = packet.intro || '';
  $('version').textContent = 'Revision ' + packet.revision;
  if (packet.coverage_note) { $('coverage').textContent = packet.coverage_note; $('coverage').hidden = false; }
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) response = Core.validateResponse(packet, JSON.parse(saved));
  } catch (e) { storageOK = false; notice('Could not restore the saved draft. Import your response file if you exported one.'); }
  $('respondent').value = response.respondent;
  for (const role of ['spec', 'tech']) {
    let previousSection;
    for (const q of Core.topological(packet).filter(q => q.audience === role)) {
      if (q.section && q.section !== previousSection) { $('panel-' + role).append(el('p', q.section, 'section-label')); previousSection = q.section; }
      $('panel-' + role).append(makeQuestion(q));
    }
    const empty = el('p', 'No questions apply to this section yet.', 'empty'); empty.id = 'empty-' + role; $('panel-' + role).append(empty);
    $('tab-' + role).addEventListener('click', () => selectTab(role));
    $('tab-' + role).addEventListener('keydown', event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); selectTab(event.key === 'Home' ? 'spec' : event.key === 'End' ? 'tech' : activeTab === 'spec' ? 'tech' : 'spec', true);
      }
    });
  }
  $('respondent').addEventListener('input', save);
  $('history').parentElement.addEventListener('toggle', () => { if ($('history').parentElement.open) renderHistory(); });
  $('import-button').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Response file is too large (maximum 10 MB).');
      startImport(JSON.parse(await file.text()));
    } catch (e) { notice('Import failed. ' + e.message); }
    finally { event.target.value = ''; }
  });
  $('merge-cancel').addEventListener('click', () => { pendingImport = null; $('merge-dialog').close(); });
  $('merge-dialog').addEventListener('cancel', () => { pendingImport = null; });
  $('merge-apply').addEventListener('click', () => {
    const choices = {};
    for (const item of $('merge-items').children) {
      const selected = item.querySelector('input:checked');
      if (!selected) { $('merge-error').textContent = 'Choose which answer to keep for every question before applying.'; return; }
      choices[item.dataset.question] = selected.value;
    }
    try {
      const result = Core.mergeResponses(packet, response, pendingImport, choices);
      if (!result.response) throw new Error('Choose which answer to keep for every conflicting question.');
      finishImport(result.response); pendingImport = null; $('merge-dialog').close();
    } catch (e) { $('merge-error').textContent = e.message; }
  });
  $('export-button').addEventListener('click', () => {
    save();
    const exported = {...response, exported_at: new Date().toISOString(), evaluation: Core.evaluate(packet, response.answers)};
    const blob = new Blob([JSON.stringify(exported, null, 2) + '\n'], {type: 'application/json'});
    const url = URL.createObjectURL(blob), a = el('a'); a.href = url;
    a.download = `${packet.packet_id}-v${packet.revision}-answers.json`.replace(/[^a-zA-Z0-9_.-]/g, '-');
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    notice(`Exported answers from both BA and DEV.${evaluation.open.length ? ` ${evaluation.open.length} questions still need clarification; you can still share this draft.` : ' Send the JSON file with the matching HTML file to the next person.'}`, 'success');
  });
  sync();
  $('save-status').textContent = storageOK ? 'Draft saves automatically as you answer.' : 'Export your answers to keep this draft.';
})();
