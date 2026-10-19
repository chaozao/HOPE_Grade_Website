document.addEventListener('DOMContentLoaded', function () {
  const token = getToken(),
    payload = getPayload(token || '');
  if (!payload) {
    location.href = 'index.html';
    return;
  }
  if (payload.role !== 'teacher') {
    location.href = 'admin-dashboard.html';
    return;
  }
  const UI = AcademicUI,
    el = (id) => document.getElementById(id),
    fields = ['hw1', 'quiz1', 'midterm', 'project1'];
  const select = el('subject-select');
  let subjectId = '',
    data = null,
    busy = false,
    dirty = false,
    stale = false,
    action = '';
  el('user-name').textContent = payload.username;
  el('logout-btn').addEventListener('click', confirmLogout);
  function weighted(scores) {
    if (fields.some((field) => scores[field] === null)) return null;
    return Number(
      (
        (scores.hw1 * 0.15 + scores.quiz1 * 0.2 + scores.midterm * 0.3 + scores.project1 * 0.15) /
        0.8
      ).toFixed(1)
    );
  }
  function entries() {
    return Array.from(document.querySelectorAll('.entry-row'), (row) => ({
      studentId: row.dataset.studentId,
      scores: Object.fromEntries(
        fields.map((field) => {
          const input = row.querySelector('[data-field="' + field + '"]');
          return [field, input.value === '' ? null : Number(input.value)];
        })
      )
    }));
  }
  function controls() {
    const locked = data?.gradeStatus === 'finalized',
      pending = data?.requests?.some((r) => r.status === 'pending');
    el('save-btn').disabled = busy || !data?.roster.length || locked || stale;
    el('finalize-btn').hidden = Boolean(locked);
    el('finalize-btn').disabled =
      busy ||
      !data?.roster.length ||
      dirty ||
      stale ||
      entries().some((e) => weighted(e.scores) === null) ||
      Boolean(document.querySelector('.state-error'));
    el('request-edit-btn').hidden = !locked;
    el('request-edit-btn').disabled = busy || pending || !data?.canRequestEdit || stale;
    el('subject-summary-btn').disabled = busy || !data;
    el('refresh-grades').disabled = busy;
    select.disabled = busy || !select.options.length;
    document.querySelectorAll('.grade-input').forEach((input) => {
      input.disabled = busy || locked || stale;
    });
  }
  async function loadRoster(id) {
    if (!id) return;
    subjectId = id;
    data = null;
    busy = true;
    stale = false;
    controls();
    el('table-section').classList.add('hidden');
    UI.status('grade-status', 'Loading grades…');
    try {
      data = await UI.api('/teacher/subjects/' + id + '/roster');
      dirty = false;
      el('page-subtitle').textContent =
        data.subjectName +
        ' — ' +
        (data.className || '') +
        ' (' +
        data.totalStudents +
        ' students)';
      const locked = data.gradeStatus === 'finalized';
      el('grade-state').textContent = locked ? 'Finalized · Locked' : 'Draft · Editable';
      el('grade-state').className = 'workflow-badge ' + (locked ? 'finalized' : 'draft');
      el('grade-state-note').textContent = locked
        ? 'Corrections require approval from ' + (data.adviserName || 'the class adviser') + '.'
        : 'Save and review scores before finalizing. Reopened subjects must be finalized again.';
      const history = el('grade-request-history');
      history.replaceChildren();
      (data.requests || [])
        .slice(0, 3)
        .forEach((r) =>
          history.appendChild(
            UI.node(
              'p',
              'Edit request: ' +
                r.status +
                ' — ' +
                r.reason +
                (r.reviewNote ? ' · Adviser: ' + r.reviewNote : '')
            )
          )
        );
      const tbody = el('entry-tbody');
      tbody.replaceChildren();
      data.roster.forEach((student) => {
        const row = UI.node('tr', undefined, 'entry-row');
        row.dataset.studentId = student.studentId;
        const name = UI.node('td', student.lastName + ', ' + student.firstName);
        name.appendChild(
          UI.node('span', 'LRN: ' + (student.lrn || 'Not recorded'), 'workflow-detail')
        );
        row.appendChild(name);
        const result = UI.node('td', undefined, 'current-grade-cell');
        function refresh() {
          let invalid = false;
          const scores = {};
          fields.forEach((field) => {
            const input = row.querySelector('[data-field="' + field + '"]');
            const error =
              input.validity.badInput ||
              (input.value !== '' &&
                (!Number.isFinite(Number(input.value)) ||
                  Number(input.value) < 0 ||
                  Number(input.value) > 100));
            input.classList.toggle('state-error', error);
            invalid ||= error;
            scores[field] = input.value === '' ? null : Number(input.value);
          });
          row.classList.toggle('has-error', invalid);
          const grade = weighted(scores);
          result.textContent = invalid
            ? 'Fix invalid scores'
            : grade === null
              ? 'Incomplete'
              : grade + '%';
        }
        fields.forEach((field) => {
          const cell = UI.node('td'),
            input = UI.node('input', undefined, 'grade-input');
          Object.assign(input, {
            type: 'number',
            min: '0',
            max: '100',
            step: 'any',
            value: student.scores[field] ?? ''
          });
          input.dataset.field = field;
          input.setAttribute(
            'aria-label',
            student.firstName + ' ' + student.lastName + ' — ' + field
          );
          input.addEventListener('input', () => {
            dirty = true;
            refresh();
            controls();
          });
          cell.appendChild(input);
          row.appendChild(cell);
        });
        row.appendChild(result);
        tbody.appendChild(row);
        refresh();
      });
      if (!data.roster.length)
        UI.empty(tbody, 'No enrolled students. A class adviser must enroll students first.', 6);
      el('table-section').classList.remove('hidden');
      UI.status('grade-status', '');
    } catch (error) {
      UI.status('grade-status', error.message, true);
      el('grade-state').textContent = 'Unavailable';
    } finally {
      busy = false;
      controls();
    }
  }
  el('save-btn').addEventListener('click', async () => {
    if (!data || busy || stale || data.gradeStatus === 'finalized') return;
    if (document.querySelector('.state-error')) {
      UI.status('grade-status', 'Fix invalid scores before saving.', true);
      return;
    }
    const body = { version: data.gradeVersion || 0, grades: entries() };
    busy = true;
    controls();
    try {
      const result = await UI.api('/teacher/subjects/' + subjectId + '/grades', {
        method: 'PUT',
        body: JSON.stringify(body)
      });
      data.gradeVersion = result.gradeVersion;
      dirty = false;
      UI.status('grade-status', result.message);
    } catch (error) {
      stale = [403, 409].includes(error.status);
      UI.status(
        'grade-status',
        error.message + (stale ? ' Refresh grades to load the latest permissions and scores.' : ''),
        true
      );
    } finally {
      busy = false;
      controls();
    }
  });
  function openAction(type) {
    if (!data || busy) return;
    action = type;
    const finalize = type === 'finalize';
    el('grade-action-title').textContent = finalize
      ? 'Finalize subject grades'
      : 'Request edit approval';
    el('grade-action-description').textContent = finalize
      ? 'Finalize ' +
        data.subjectName +
        ' for all ' +
        data.totalStudents +
        ' enrolled students? Grades will be locked. Only the class adviser can approve reopening.'
      : 'Explain the correction needed. The request goes to ' +
        (data.adviserName || 'the class adviser') +
        '. Grades remain locked until approved.';
    el('grade-reason-label').hidden = finalize;
    el('grade-reason').required = !finalize;
    el('grade-reason').value = '';
    el('confirm-grade-action').textContent = finalize ? 'Finalize and lock' : 'Send request';
    UI.status('grade-action-status', '');
    el('grade-action-dialog').showModal();
  }
  el('finalize-btn').addEventListener('click', () => openAction('finalize'));
  el('request-edit-btn').addEventListener('click', () => openAction('edit-requests'));
  el('cancel-grade-action').addEventListener('click', () => {
    if (!busy) el('grade-action-dialog').close();
  });
  el('grade-action-dialog').addEventListener('cancel', (event) => {
    if (busy) event.preventDefault();
  });
  el('grade-action-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !data) return;
    busy = true;
    controls();
    el('confirm-grade-action').disabled = true;
    try {
      const result = await UI.api('/teacher/subjects/' + subjectId + '/' + action, {
        method: 'POST',
        body: JSON.stringify({
          version: data.gradeVersion || 0,
          reason: el('grade-reason').value.trim()
        })
      });
      el('grade-action-dialog').close();
      await loadRoster(subjectId);
      UI.status('grade-status', result.message);
    } catch (error) {
      UI.status('grade-action-status', error.message, true);
    } finally {
      busy = false;
      controls();
      el('confirm-grade-action').disabled = false;
    }
  });
  el('subject-summary-btn').addEventListener('click', async () => {
    try {
      UI.showReport(await UI.api('/teacher/subjects/' + subjectId + '/summary'), 'subject');
    } catch (error) {
      UI.status('grade-status', error.message, true);
    }
  });
  function mayDiscard() {
    return !dirty || window.confirm('Discard unsaved scores and load the latest saved grades?');
  }
  el('refresh-grades').addEventListener('click', () => {
    if (mayDiscard()) {
      dirty = false;
      if (select.value) loadRoster(select.value);
      else init();
    }
  });
  select.addEventListener('change', () => {
    if (mayDiscard()) {
      dirty = false;
      loadRoster(select.value);
    } else select.value = subjectId;
  });
  window.addEventListener('beforeunload', (event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  async function init() {
    busy = true;
    controls();
    try {
      const subjects = await UI.api('/teacher/my-subjects');
      configureAdvisorNavigation(token, subjects).catch((error) =>
        console.error('Could not load adviser navigation:', error)
      );
      select.replaceChildren();
      subjects.forEach((s) => select.appendChild(new Option(s.name + ' — ' + s.className, s._id)));
      el('no-subjects-message').classList.toggle('hidden', subjects.length > 0);
      if (!subjects.length) {
        el('grade-state').textContent = 'No teaching assignments';
        return;
      }
      const requested = new URLSearchParams(location.search).get('subject');
      if (subjects.some((s) => s._id === requested)) select.value = requested;
      await loadRoster(select.value);
      if (data && location.hash === '#finalization') {
        el('grade-state-note').scrollIntoView({ block: 'center' });
        const button = el(data.gradeStatus === 'finalized' ? 'request-edit-btn' : 'finalize-btn');
        if (!button.disabled) button.focus({ preventScroll: true });
      }
    } catch (error) {
      UI.status('grade-status', error.message, true);
    } finally {
      busy = false;
      controls();
    }
  }
  init();
});
