document.addEventListener('DOMContentLoaded', () => {
  const el = (id) => document.getElementById('narrative-' + id);
  if (!el('students')) return;
  if (document.getElementById('student-report-tab-values')?.hidden) return;
  const UI = AcademicUI;
  let subjects = [], students = [], page = 1, request = 0, loaded = false, loading = false;
  const drafts = new Map();
  let context = null, saving = false;
  const keyFor = (student) => context.subject + ':' + context.term + ':' + student.studentId;
  const pending = () => context ? students.filter((student) => drafts.has(keyFor(student))) : [];
  const compare = (a, b) => (a || '').localeCompare(b || '', 'en', { sensitivity: 'base', numeric: true });
  const gradesFor = (s) => [s.gradeLevel, ...(s.gradeLevels || [])].filter(Boolean);
  function choices(id, label, items) {
    el(id).replaceChildren(new Option(label, ''));
    items.forEach(([value, text]) => el(id).appendChild(new Option(text, value)));
  }
  function pagination() {
    const pages = Math.max(1, Math.ceil(students.length / 8));
    el('page').textContent = 'Page ' + page + ' of ' + pages;
    el('prev').disabled = saving || page <= 1;
    el('next').disabled = saving || page >= pages;
    el('save').disabled = saving || !pending().length;
    el('save').textContent = saving ? 'Saving?' : 'Save Report';
  }
  function clear() {
    request++;
    students = []; page = 1; context = null;
    el('students').replaceChildren();
    UI.empty(el('students'), 'Select a grade level, section, and subject to view students.', 3);
    el('status').textContent = '';
    el('retry').hidden = true;
    pagination();
  }
  function render() {
    el('students').replaceChildren();
    students.slice((page - 1) * 8, page * 8).forEach((student) => {
      const name = student.lastName + ', ' + student.firstName;
      const key = keyFor(student);
      const fields = ['canDo', 'improving'].map((field, index) => {
        const input = UI.node('textarea', undefined, 'narrative-input');
        input.value = (drafts.get(key) || student)[field] || '';
        input.rows = 4;
        input.maxLength = 10000;
        input.disabled = saving;
        input.setAttribute('aria-label', name + ' ? ' + (index ? 'What Your Child Is Learning to Improve' : 'What Your Child Can Do'));
        input.addEventListener('input', () => {
          const draft = { canDo: student.canDo || '', improving: student.improving || '', ...drafts.get(key), [field]: input.value };
          if (draft.canDo === (student.canDo || '') && draft.improving === (student.improving || '')) drafts.delete(key);
          else drafts.set(key, draft);
          pagination();
          el('status').textContent = pending().length ? 'Unsaved changes. Save Report saves all pages for the selected subject and term.' : '';
        });
        return input;
      });
      UI.row(el('students'), [name, ...fields]);
    });
    if (!students.length) UI.empty(el('students'), 'No students enrolled in this subject.', 3);
    pagination();
  }
  async function loadStudents() {
    clear();
    const subject = el('subject').value;
    if (!subject || !el('grade').value || !el('section').value) return;
    const current = request;
    const term = Number(el('term').value);
    el('students').replaceChildren();
    UI.empty(el('students'), 'Loading students…', 3);
    try {
      const data = await UI.api('/teacher/subjects/' + encodeURIComponent(subject) + '/narrative-reports?term=' + term);
      if (current !== request) return;
      context = { subject, term };
      students = [...data.roster].sort((a, b) => compare(a.lastName, b.lastName) || compare(a.firstName, b.firstName));
      render();
    } catch (error) {
      if (current !== request) return;
      el('students').replaceChildren();
      UI.empty(el('students'), 'Could not load students.', 3);
      el('status').textContent = error.message;
      el('retry').hidden = false;
    }
  }
  async function loadOptions() {
    if (loaded || loading || location.hash !== '#student-reports') return;
    loading = true;
    el('status').textContent = 'Loading your assigned subjects…';
    el('retry').hidden = true;
    try {
      subjects = await UI.api('/adviser/report-subjects');
      choices('grade', 'Select grade level', [...new Set(subjects.flatMap(gradesFor))].sort(compare).map((grade) => [grade, grade]));
      loaded = true;
      el('grade').disabled = false;
      el('status').textContent = subjects.some((s) => gradesFor(s).length) ? '' : 'No grade levels found for your assigned subjects.';
    } catch (error) {
      el('status').textContent = error.message;
      el('retry').hidden = false;
    } finally { loading = false; }
  }
  el('grade').addEventListener('change', () => {
    clear();
    const sections = new Map(subjects.filter((s) => gradesFor(s).includes(el('grade').value)).map((s) => [s.classId, s.section || s.className]));
    choices('section', 'Select section', [...sections].sort((a, b) => compare(a[1], b[1])));
    el('section').disabled = !el('grade').value;
    choices('subject', 'Select subject', []);
    el('subject').disabled = true;
  });
  el('section').addEventListener('change', () => {
    clear();
    choices('subject', 'Select subject', subjects.filter((s) => s.classId === el('section').value && gradesFor(s).includes(el('grade').value)).sort((a, b) => compare(a.name, b.name)).map((s) => [s._id, s.name]));
    el('subject').disabled = !el('section').value;
  });
  el('subject').addEventListener('change', loadStudents);
  el('term').addEventListener('change', loadStudents);
  el('prev').addEventListener('click', () => { if (!saving && page > 1) { page--; render(); } });
  el('next').addEventListener('click', () => { if (!saving && page * 8 < students.length) { page++; render(); } });
  el('retry').addEventListener('click', () => loaded ? loadStudents() : loadOptions());
  el('save').addEventListener('click', async () => {
    if (saving || !pending().length) return;
    saving = true; render();
    ['grade', 'section', 'subject', 'term'].forEach((id) => { el(id).disabled = true; });
    el('status').textContent = 'Saving reports?';
    try {
      for (const student of pending()) {
        const key = keyFor(student), draft = drafts.get(key);
        await UI.api('/teacher/subjects/' + encodeURIComponent(context.subject) + '/narrative-reports/' + encodeURIComponent(student.studentId), {
          method: 'PUT', body: JSON.stringify({ term: context.term, ...draft })
        });
        Object.assign(student, draft);
        drafts.delete(key);
      }
      el('status').textContent = 'Reports saved.';
    } catch (error) {
      el('status').textContent = 'Some reports were not saved. ' + error.message + ' Your remaining changes are kept; click Save Report to retry.';
    } finally {
      saving = false;
      ['grade', 'section', 'subject', 'term'].forEach((id) => { el(id).disabled = false; });
      render();
    }
  });
  window.addEventListener('beforeunload', (event) => {
    if (saving || drafts.size) { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('hashchange', loadOptions);
  loadOptions();
});
