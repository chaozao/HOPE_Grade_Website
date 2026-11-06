document.addEventListener('DOMContentLoaded', function () {
  const root = document.getElementById('view-student-reports');
  if (!root) return;
  const tabs = [...root.querySelectorAll('[data-student-report-tab]')];
  const panels = root.querySelectorAll('[data-student-report-panel]');
  const UI = AcademicUI;
  const el = (id) => document.getElementById('attendance-' + id);
  let subjects = [], loaded = false, loading = false, request = 0;
  const today = new Date();
  el('date').value = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  let saving = false, students = [], page = 1, context = null;
  const drafts = new Map();
  const pageSize = 8;
  const draftKey = (studentId) => context.subjectId + ':' + context.date + ':' + studentId;
  const states = [
    ['unmarked', 'Unmarked', 'bi-ban'],
    ['absent', 'Absent', 'bi-x-lg'],
    ['present', 'Present', 'bi-check-lg'],
    ['tardy', 'Tardy', 'bi-check2']
  ];
  const gradesFor = (subject) => [...new Set([subject.gradeLevel, ...(subject.gradeLevels || [])].filter(Boolean))];
  const compare = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });
  function choices(select, label, items) {
    select.replaceChildren(new Option(label, ''));
    items.forEach(([value, text]) => select.appendChild(new Option(text, value)));
  }
  function clearRows() {
    ++request;
    students = []; context = null; page = 1;
    controls();
    el('students').replaceChildren();
    UI.empty(el('students'), 'Select a grade level, section, and subject to view students.', 2);
    el('status').textContent = '';
    el('retry').hidden = true;
  }
  el('grade').addEventListener('change', () => {
    clearRows();
    const sections = new Map(subjects.filter((s) => gradesFor(s).includes(el('grade').value))
      .map((s) => [s.classId, s.section || s.className]));
    choices(el('section'), 'Select section', [...sections].sort((a, b) => compare(a[1], b[1])));
    el('section').disabled = !el('grade').value;
    choices(el('subject'), 'Select subject', []);
    el('subject').disabled = true;
  });
  el('section').addEventListener('change', () => {
    clearRows();
    choices(el('subject'), 'Select subject', subjects
      .filter((s) => s.classId === el('section').value && gradesFor(s).includes(el('grade').value))
      .sort((a, b) => compare(a.name, b.name)).map((s) => [s._id, s.name]));
    el('subject').disabled = !el('section').value;
  });
  async function loadStudents() {
    clearRows();
    const subjectId = el('subject').value;
    if (!subjectId) return;
    const date = el('date').value;
    if (!date) {
      el('status').textContent = 'Select an attendance date.';
      return;
    }
    const current = request;
    el('students').replaceChildren();
    UI.empty(el('students'), 'Loading students…', 2);
    try {
      const data = await UI.api('/teacher/subjects/' + encodeURIComponent(subjectId) + '/attendance?date=' + encodeURIComponent(date));
      if (current !== request) return;
      context = { subjectId, date };
      students = [...data.roster].sort((a, b) => compare(a.lastName, b.lastName) || compare(a.firstName, b.firstName));
      renderRows();
      note();
    } catch (error) {
      if (current !== request) return;
      el('students').replaceChildren();
      UI.empty(el('students'), 'Could not load students.', 2);
      el('status').textContent = error.message;
      el('retry').hidden = false;
    }
  }
  function pending() {
    return context ? students.filter((student) => drafts.has(draftKey(student.studentId))) : [];
  }
  function controls() {
    const pages = Math.max(1, Math.ceil(students.length / pageSize));
    el('page').textContent = 'Page ' + page + ' of ' + pages;
    el('prev').disabled = saving || page <= 1;
    el('next').disabled = saving || page >= pages;
    el('save').disabled = saving || !pending().length;
    el('save').textContent = saving ? 'Saving?' : 'Save Attendance';
  }
  function note() {
    const count = pending().length;
    el('status').textContent = count
      ? count + ' unsaved change(s) for ' + context.date + '. Click Save Attendance to save all pages.'
      : 'Click a status to change it, then click Save Attendance.';
  }
  function renderRows() {
    el('students').replaceChildren();
    students.slice((page - 1) * pageSize, page * pageSize).forEach((student) => {
      const name = student.lastName + ', ' + student.firstName;
      const key = draftKey(student.studentId);
      const button = UI.node('button', undefined, 'attendance-action');
      button.type = 'button';
      button.disabled = saving;
      function paint() {
        const status = drafts.get(key) ?? student.status ?? 'unmarked';
        const index = Math.max(0, states.findIndex((state) => state[0] === status));
        const [state, label, icon] = states[index];
        button.className = 'attendance-action is-' + state;
        button.replaceChildren(UI.node('i', undefined, 'bi ' + icon), UI.node('span', label));
        button.firstElementChild.setAttribute('aria-hidden', 'true');
        button.setAttribute('aria-label', name + ': ' + label + '. Change to ' + states[(index + 1) % states.length][1]);
        button.title = 'Click to change: Unmarked ? Absent ? Present ? Tardy ? Unmarked';
        return index;
      }
      button.addEventListener('click', () => {
        if (saving) return;
        const next = states[(paint() + 1) % states.length][0];
        if (next === (student.status || 'unmarked')) drafts.delete(key);
        else drafts.set(key, next);
        paint(); controls(); note();
      });
      paint();
      UI.row(el('students'), [name, button]);
    });
    if (!students.length) UI.empty(el('students'), 'No students enrolled in this subject.', 2);
    controls();
  }
  el('prev').addEventListener('click', () => { if (!saving && page > 1) { page--; renderRows(); } });
  el('next').addEventListener('click', () => { if (!saving && page * pageSize < students.length) { page++; renderRows(); } });
  el('save').addEventListener('click', async () => {
    if (saving || !pending().length) return;
    saving = true;
    renderRows();
    ['date', 'grade', 'section', 'subject'].forEach((id) => { el(id).disabled = true; });
    el('status').textContent = 'Saving attendance?';
    try {
      for (const student of pending()) {
        const key = draftKey(student.studentId);
        const status = drafts.get(key);
        await UI.api('/teacher/subjects/' + encodeURIComponent(context.subjectId) + '/attendance/' + encodeURIComponent(student.studentId), {
          method: 'PUT', body: JSON.stringify({ date: context.date, status })
        });
        student.status = status;
        drafts.delete(key);
      }
      el('status').textContent = 'Attendance saved for ' + context.date + '.';
    } catch (error) {
      el('status').textContent = 'Some changes were not saved. ' + error.message + ' Your remaining changes are kept; click Save Attendance to retry.';
    } finally {
      saving = false;
      ['date', 'grade', 'section', 'subject'].forEach((id) => { el(id).disabled = false; });
      renderRows();
    }
  });
  controls();
  el('subject').addEventListener('change', loadStudents);
  el('date').addEventListener('change', loadStudents);
  window.addEventListener('beforeunload', (event) => {
    if (saving || drafts.size) { event.preventDefault(); event.returnValue = ''; }
  });
  async function loadOptions() {
    if (loaded || loading || location.hash !== '#student-reports') return;
    loading = true;
    el('grade').disabled = true;
    el('status').textContent = 'Loading your assigned subjects…';
    el('retry').hidden = true;
    try {
      subjects = await UI.api('/teacher/my-subjects');
      choices(el('grade'), 'Select grade level', [...new Set(subjects.flatMap(gradesFor))]
        .sort(compare).map((grade) => [grade, grade]));
      loaded = true;
      el('status').textContent = subjects.some((s) => gradesFor(s).length) ? '' : 'No assigned subjects have a grade level. Ask your admin to set the class grade level.';
    } catch (error) {
      el('status').textContent = error.message;
      el('retry').hidden = false;
    } finally {
      loading = false;
      el('grade').disabled = !loaded;
    }
  }
  el('retry').addEventListener('click', () => loaded ? loadStudents() : loadOptions());
  window.addEventListener('hashchange', loadOptions);
  loadOptions();

  function selectTab(tab) {
    tabs.forEach((button) => {
      const active = button === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.studentReportPanel !== tab.dataset.studentReportTab;
    });
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (event) => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      selectTab(tabs[next]);
      tabs[next].focus();
    });
  });
});
