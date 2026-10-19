window.HomeroomRoster = (function () {
  const UI = AcademicUI;
  const el = (id) => document.getElementById(id);
  let options,
    advisoryClass,
    initialized = false,
    bound = false,
    page = 1,
    pages = 1,
    request = 0,
    optionsRequest = 0;
  const compare = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  function choices(id, label, items, selected = '') {
    const select = el(id);
    select.replaceChildren(new Option(label, ''));
    items.forEach((item) => select.appendChild(new Option(item.label, item.value)));
    select.value = items.some((item) => item.value === selected) ? selected : '';
  }
  function classesForGrade() {
    const grade = el('roster-grade').value;
    return options.classes.filter(
      (cls) =>
        !grade ||
        cls.gradeLevel === grade ||
        options.rosterGrades?.some((row) => row.classId === cls._id && row.gradeLevel === grade)
    );
  }
  function subjects(selected = '') {
    const section = el('roster-section').value;
    choices(
      'roster-subject',
      'Select subject',
      options.subjects
        .filter((subject) => section && (subject.class?._id || subject.class) === section)
        .map((subject) => ({ value: subject._id, label: subject.name })),
      selected
    );
  }
  function sections(selected = '', subject = '') {
    choices(
      'roster-section',
      'Select section',
      classesForGrade().map((cls) => ({ value: cls._id, label: cls.section || cls.name })),
      selected
    );
    subjects(subject);
  }
  function pendingFilters() {
    ++request;
    page = 1;
    const hasGrade = Boolean(el('roster-grade').value);
    el('roster-section').disabled = !hasGrade;
    el('roster-subject').disabled = !hasGrade || !el('roster-section').value;
    if (!hasGrade) {
      choices('roster-section', 'Select section', []);
      choices('roster-subject', 'Select subject', []);
    }
    if (!el('roster-section').value) choices('roster-subject', 'Select subject', []);
    el('roster-prev').disabled = true;
    el('roster-next').disabled = true;
    el('retry-homeroom-filter').hidden = true;
    el('homeroom-tbody').replaceChildren();
    el('homeroom-count').textContent = '';
    el('roster-page').textContent = '';
    UI.status(
      'homeroom-filter-status',
      !hasGrade
        ? 'Select a grade level first.'
        : !el('roster-section').value
          ? 'Select a section to unlock subjects.'
          : 'Select a subject to view students.'
    );
    if (hasGrade && el('roster-section').value && el('roster-subject').value) refresh();
  }
  async function refresh() {
    if (!el('roster-grade').value || !el('roster-section').value || !el('roster-subject').value)
      return;
    const current = ++request;
    el('roster-prev').disabled = true;
    el('roster-next').disabled = true;
    el('retry-homeroom-filter').hidden = true;
    UI.status('homeroom-filter-status', 'Loading students…');
    const tbody = el('homeroom-tbody');
    tbody.replaceChildren();
    el('homeroom-count').textContent = '';
    el('roster-page').textContent = '';
    try {
      const params = new URLSearchParams({
        gradeLevel: el('roster-grade').value,
        classId: el('roster-section').value,
        subjectId: el('roster-subject').value,
        page
      });
      const data = await UI.api('/adviser/students?' + params);
      if (current !== request) return;
      pages = data.pages;
      data.students.forEach((student) =>
        UI.row(tbody, [
          student.lrn || 'Not recorded',
          student.lastName + ', ' + student.firstName,
          student.middleName || student.middleInitial || '—',
          student.gender,
          student.gradeLevel || student.class?.gradeLevel || 'Not recorded'
        ])
      );
      if (!data.students.length)
        UI.empty(tbody, 'No students match the selected grade level, section, and subject.', 5);
      el('homeroom-count').textContent =
        data.total + (data.total === 1 ? ' student' : ' students') + ' · Last name A–Z';
      el('roster-page').textContent = 'Page ' + data.page + ' of ' + pages;
      el('roster-prev').disabled = page <= 1;
      el('roster-next').disabled = page >= pages;
      UI.status('homeroom-filter-status', '');
    } catch (error) {
      if (current !== request) return;
      UI.status('homeroom-filter-status', error.message, true);
      el('retry-homeroom-filter').hidden = false;
    }
  }
  async function load(cls) {
    advisoryClass = cls;
    const current = ++optionsRequest;
    ++request;
    if (!bound) {
      bound = true;
      el('roster-grade').addEventListener('change', () => {
        sections();
        pendingFilters();
      });
      el('roster-section').addEventListener('change', () => {
        subjects();
        pendingFilters();
      });
      el('roster-subject').addEventListener('change', pendingFilters);
      el('roster-prev').addEventListener('click', () => {
        if (page > 1) {
          page--;
          refresh();
        }
      });
      el('roster-next').addEventListener('click', () => {
        if (page < pages) {
          page++;
          refresh();
        }
      });
      el('retry-homeroom-filter').addEventListener('click', () => load(advisoryClass));
    }
    const selected = initialized
      ? {
          grade: el('roster-grade').value,
          section: el('roster-section').value,
          subject: el('roster-subject').value
        }
      : { grade: '', section: '', subject: '' };
    ['roster-grade', 'roster-section', 'roster-subject', 'roster-prev', 'roster-next'].forEach(
      (id) => {
        el(id).disabled = true;
      }
    );
    el('retry-homeroom-filter').hidden = true;
    el('homeroom-tbody').replaceChildren();
    el('homeroom-count').textContent = '';
    el('roster-page').textContent = '';
    UI.status('homeroom-filter-status', 'Loading roster filters…');
    try {
      const loadedOptions = await UI.api('/adviser/student-options');
      if (current !== optionsRequest) return;
      options = loadedOptions;
      const grades = [
        ...new Set(
          [
            ...options.classes.map((item) => item.gradeLevel),
            ...(options.rosterGrades || []).map((item) => item.gradeLevel)
          ].filter(Boolean)
        )
      ].sort(compare);
      choices(
        'roster-grade',
        'Select grade level',
        grades.map((value) => ({ value, label: value })),
        selected.grade
      );
      sections(selected.section, selected.subject);
      initialized = true;
      el('roster-grade').disabled = false;
      pendingFilters();
    } catch (error) {
      if (current !== optionsRequest) return;
      UI.status('homeroom-filter-status', error.message, true);
      el('retry-homeroom-filter').hidden = false;
    }
  }
  return { load };
})();
