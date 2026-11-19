document.addEventListener('DOMContentLoaded', () => {
  const el = (id) => document.getElementById('values-' + id);
  if (!el('grade')) return;
  if (document.getElementById('student-report-tab-values')?.hidden) return;
  const UI = AcademicUI;
  let subjects = [], loaded = false, loading = false, students = [], page = 1, request = 0;
  let category = 'filipino', context = null, editor = null, saving = false;
  const drafts = new Map();
  const catalog = window.CoreValues;
  const draftKey = (student, type = category, term = Number(el('term').value)) => context + ':' + student.studentId + ':' + type + ':' + term;
  function original(student, type, term) {
    return student.reports?.find((report) => report.category === type && report.term === term)?.ratings || {};
  }
  function clearRoster() {
    request++; students = []; context = null; page = 1;
    el('students').replaceChildren();
    UI.empty(el('students'), 'Select a grade level, section, and subject to view students.', 3);
    el('prev').disabled = el('next').disabled = true;
    el('page').textContent = 'Page 1 of 1';
    status('');
  }
  function renderRoster() {
    el('students').replaceChildren();
    const term = Number(el('term').value);
    students.slice((page - 1) * 8, page * 8).forEach((student) => {
      const key = draftKey(student);
      const values = drafts.get(key) || original(student, category, term);
      const count = catalog[category].items.filter(([id]) => ['AO', 'SO', 'RO', 'NO'].includes(values[id])).length;
      const edit = UI.button('Edit Values', () => openEditor(student));
      edit.setAttribute('aria-label', 'Edit ' + catalog[category].label + ' for ' + student.lastName + ', ' + student.firstName);
      UI.row(el('students'), [student.lastName + ', ' + student.firstName,
        count + '/' + catalog[category].items.length + ' completed' + (drafts.has(key) ? ' ? Unsaved' : ''), edit]);
    });
    if (!students.length) UI.empty(el('students'), 'No students enrolled in this subject.', 3);
    const pages = Math.max(1, Math.ceil(students.length / 8));
    el('page').textContent = 'Page ' + page + ' of ' + pages;
    el('prev').disabled = page <= 1;
    el('next').disabled = page >= pages;
  }
  async function loadStudents() {
    clearRoster();
    const subject = el('subject').value;
    if (!subject || !el('section').value || !el('grade').value) return;
    const current = request;
    status('Loading students...'); el('retry').hidden = true;
    try {
      const data = await UI.api('/teacher/subjects/' + encodeURIComponent(subject) + '/core-values');
      if (current !== request) return;
      context = subject;
      students = [...data.roster].sort((a, b) => compare(a.lastName, b.lastName) || compare(a.firstName, b.firstName));
      renderRoster(); status('');
    } catch (error) {
      if (current !== request) return;
      status(error.message); el('retry').hidden = false;
    }
  }
  function editorStatus(message) {
    el('dialog-status').textContent = message;
    el('dialog-status').hidden = !message;
  }
  function openEditor(student) {
    const term = Number(el('term').value), type = category, key = draftKey(student, type, term);
    editor = { student, term, type, key, subject: context };
    const values = { ...original(student, type, term), ...drafts.get(key) };
    for (const [id] of catalog[type].items) if (!['AO', 'SO', 'RO', 'NO'].includes(values[id])) values[id] = ''; 
    const subject = subjects.find((item) => item._id === context);
    el('dialog-title').textContent = student.lastName + ', ' + student.firstName;
    el('dialog-context').textContent = [el('grade').value, subject?.section || subject?.className, subject?.name, el('term').selectedOptions[0].textContent].filter(Boolean).join(' ? ');
    el('dialog-category').textContent = catalog[type].label + ' ? Select a rating for each behavior in the selected term.';
    editorStatus(''); el('save').disabled = !drafts.has(key);
    el('dialog-body').replaceChildren();
    catalog[type].items.forEach(([id, value, statement], index, items) => {
      const startsGroup = index === 0 || items[index - 1][1] !== value;
      const cells = startsGroup ? [value, statement] : [statement];
      for (let column = 1; column <= 3; column++) {
        if (column !== term) { cells.push(['AO', 'SO', 'RO', 'NO'].includes(original(student, type, column)[id]) ? original(student, type, column)[id] : 'Not rated'); continue; }
        const select = UI.node('select', undefined, 'values-input');
        select.appendChild(new Option('Select rating', ''));
        for (const [code, label] of [['AO', 'Always Observed'], ['SO', 'Sometimes Observed'], ['RO', 'Rarely Observed'], ['NO', 'Not Observed']]) select.appendChild(new Option(code + ' (' + label + ')', code));
        select.value = values[id] || '';
        select.setAttribute('aria-label', student.lastName + ', ' + student.firstName + ': ' + statement + ', term ' + term);
        select.addEventListener('change', () => {
          values[id] = select.value;
          const saved = original(student, type, term);
          if (catalog[type].items.every(([item]) => (values[item] || '') === (saved[item] || ''))) drafts.delete(key);
          else drafts.set(key, { ...values });
          el('save').disabled = !drafts.has(key);
          editorStatus(drafts.has(key) ? 'Unsaved changes for this student. Click Save Values.' : '');
        });
        cells.push(select);
      }
      const row = UI.row(el('dialog-body'), cells);
      if (startsGroup) {
        let span = 1;
        while (index + span < items.length && items[index + span][1] === value) span++;
        row.children[0].rowSpan = span;
        row.children[0].className = 'values-group-label';
      }
      const firstTermCell = startsGroup ? 2 : 1;
      for (let cell = firstTermCell; cell < row.children.length; cell++)
        row.children[cell].className = 'values-term-cell';
    });
    el('dialog').showModal();
  }
  el('save').addEventListener('click', async () => {
    if (saving || !editor || !drafts.has(editor.key)) return;
    const current = editor, values = drafts.get(current.key);
    saving = true; el('save').disabled = el('close').disabled = true;
    el('dialog-body').querySelectorAll('select').forEach((input) => { input.disabled = true; });
    editorStatus('Saving values...');
    try {
      await UI.api('/teacher/subjects/' + encodeURIComponent(current.subject) + '/core-values/' + encodeURIComponent(current.student.studentId), {
        method: 'PUT', body: JSON.stringify({ category: current.type, term: current.term, ratings: values })
      });
      current.student.reports ||= [];
      current.student.reports = current.student.reports.filter((report) => report.category !== current.type || report.term !== current.term);
      current.student.reports.push({ category: current.type, term: current.term, ratings: { ...values } });
      drafts.delete(current.key); editorStatus('Values saved for ' + current.student.lastName + ', ' + current.student.firstName + '.');
      renderRoster();
    } catch (error) { editorStatus('Could not save values. ' + error.message + ' Your changes are kept; try Save Values again.'); }
    finally {
      saving = false; el('close').disabled = false; el('save').disabled = !drafts.has(current.key);
      el('dialog-body').querySelectorAll('select').forEach((input) => { input.disabled = false; });
    }
  });
  el('close').addEventListener('click', () => { if (!saving) el('dialog').close(); });
  el('dialog').addEventListener('cancel', (event) => { if (saving) event.preventDefault(); });
  el('dialog').addEventListener('close', () => { if (context) renderRoster(); });
  el('dialog').addEventListener('click', (event) => {
    if (saving || event.target !== el('dialog')) return;
    const rect = el('dialog').getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) el('dialog').close();
  });
  for (const type of ['filipino', 'personal']) el(type).addEventListener('click', () => {
    category = type; page = 1;
    for (const name of ['filipino', 'personal']) {
      el(name).classList.toggle('active', name === type);
      el(name).setAttribute('aria-pressed', String(name === type));
    }
    if (context) renderRoster();
  });
  el('subject').addEventListener('change', loadStudents);
  el('term').addEventListener('change', () => { page = 1; if (context) renderRoster(); });
  el('prev').addEventListener('click', () => { if (page > 1) { page--; renderRoster(); } });
  el('next').addEventListener('click', () => { if (page * 8 < students.length) { page++; renderRoster(); } });
  window.addEventListener('beforeunload', (event) => { if (saving || drafts.size) { event.preventDefault(); event.returnValue = ''; } });
  const compare = (a, b) => (a || '').localeCompare(b || '', 'en', { sensitivity: 'base', numeric: true });
  const gradesFor = (subject) => [subject.gradeLevel, ...(subject.gradeLevels || [])].filter(Boolean);
  function choices(id, label, items) {
    el(id).replaceChildren(new Option(label, ''));
    items.forEach(([value, text]) => el(id).appendChild(new Option(text, value)));
  }
  function status(message) {
    el('status').textContent = message;
    el('status').hidden = !message;
  }
  async function loadOptions() {
    if (loaded || loading || location.hash !== '#student-reports') return;
    loading = true;
    el('retry').hidden = true;
    status('Loading your assigned subjects...');
    try {
      subjects = await AcademicUI.api('/adviser/report-subjects');
      const grades = [...new Set(subjects.flatMap(gradesFor))].sort(compare);
      choices('grade', 'Select grade level', grades.map((grade) => [grade, grade]));
      loaded = true;
      el('grade').disabled = false;
      status(grades.length ? '' : 'No grade levels found for your assigned subjects.');
    } catch (error) {
      status(error.message);
      el('retry').hidden = false;
    } finally { loading = false; }
  }
  el('grade').addEventListener('change', () => {
    clearRoster();
    const sections = new Map(subjects.filter((s) => gradesFor(s).includes(el('grade').value))
      .map((s) => [s.classId, s.section || s.className]));
    choices('section', 'Select section', [...sections].sort((a, b) => compare(a[1], b[1])));
    el('section').disabled = !el('grade').value;
    choices('subject', 'Select subject', []);
    el('subject').disabled = true;
  });
  el('section').addEventListener('change', () => {
    clearRoster();
    choices('subject', 'Select subject', subjects.filter((s) => s.classId === el('section').value && gradesFor(s).includes(el('grade').value))
      .sort((a, b) => compare(a.name, b.name)).map((s) => [s._id, s.name]));
    el('subject').disabled = !el('section').value;
  });
  el('retry').addEventListener('click', () => loaded ? loadStudents() : loadOptions());
  window.addEventListener('hashchange', loadOptions);
  loadOptions();
});
