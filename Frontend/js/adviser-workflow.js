document.addEventListener('DOMContentLoaded', function () {
  if (getPayload(getToken() || '')?.role !== 'teacher') return;
  const UI = AcademicUI;
  const byId = (id) => document.getElementById(id);
  let tab = 'homeroom',
    page = 1,
    pages = 1,
    options = null,
    editing = null,
    saving = false,
    review = null;
  let searchTimer,
    registryRequest = 0;
  const dialog = byId('student-dialog');
  async function run(work) {
    byId('retry-adviser-tool').hidden = true;
    UI.status('adviser-tool-status', 'Loading…');
    try {
      if ((await work()) !== false) UI.status('adviser-tool-status', '');
    } catch (error) {
      UI.status('adviser-tool-status', error.message, true);
      byId('retry-adviser-tool').hidden = false;
    }
  }
  async function loadOptions() {
    options = await UI.api('/adviser/student-options');
    const filter = byId('student-class-filter');
    const previous = filter.value;
    filter.replaceChildren(new Option('All classes', ''));
    options.classes.forEach((cls) => filter.appendChild(new Option(cls.name, cls._id)));
    filter.value = previous;
  }
  async function loadRegistry() {
    const request = ++registryRequest;
    const params = new URLSearchParams({
      q: byId('student-search').value.trim(),
      classId: byId('student-class-filter').value,
      page
    });
    let data;
    try {
      data = await UI.api('/adviser/students?' + params);
    } catch (error) {
      if (request !== registryRequest) return false;
      throw error;
    }
    if (request !== registryRequest) return false;
    pages = data.pages;
    const tbody = byId('registry-tbody');
    tbody.replaceChildren();
    data.students.forEach((student) => {
      const edit = UI.button('Edit record', () => run(() => openStudent(student)));
      UI.row(tbody, [
        student.lrn || 'Not recorded',
        [student.lastName + ',', student.firstName, student.middleName || student.middleInitial]
          .filter(Boolean)
          .join(' '),
        student.gender,
        student.gradeLevel || student.class?.gradeLevel || 'Not recorded',
        student.class?.name || 'Not assigned',
        edit
      ]);
    });
    if (!data.students.length) UI.empty(tbody, 'No students match this search.', 6);
    byId('student-page-info').textContent =
      data.total + ' students · Page ' + data.page + ' of ' + data.pages;
    byId('students-prev').disabled = page <= 1;
    byId('students-next').disabled = page >= pages;
  }
  function studentSubjects(selected = []) {
    const classId = byId('student-class').value;
    const list = byId('student-subjects');
    list.replaceChildren();
    const subjects = options.subjects.filter(
      (subject) => String(subject.class?._id || subject.class) === classId
    );
    subjects.forEach((subject) => {
      const label = UI.node('label'),
        input = UI.node('input');
      input.type = 'checkbox';
      input.value = subject._id;
      input.checked = selected.includes(subject._id);
      input.disabled = subject.gradeStatus === 'finalized';
      label.append(
        input,
        UI.node(
          'span',
          subject.name +
            ' — ' +
            (subject.teacher?.username || 'Teacher not assigned') +
            (input.disabled ? ' (finalized: enrollment locked)' : '')
        )
      );
      list.appendChild(label);
    });
    if (!subjects.length)
      list.textContent =
        'No subjects in this class yet. You can save the student and assign subjects later.';
  }
  async function openStudent(student = null) {
    await loadOptions();
    if (!options.classes.length)
      throw new Error(
        'Ask the super admin to create a class / section before registering students.'
      );
    editing = student;
    byId('student-form').reset();
    UI.status('student-form-status', '');
    byId('student-dialog-title').textContent = student ? 'Edit student record' : 'Register student';
    byId('student-lrn').value = student?.lrn || '';
    byId('student-first-name').value = student?.firstName || '';
    byId('student-last-name').value = student?.lastName || '';
    byId('student-middle-name').value = student?.middleName || student?.middleInitial || '';
    byId('student-gender').value = student?.gender || '';
    const select = byId('student-class');
    select.replaceChildren(new Option('Select a class / section', ''));
    options.classes.forEach((cls) => select.appendChild(new Option(cls.name, cls._id)));
    select.value = student?.class?._id || '';
    byId('student-grade-level').value = student?.gradeLevel || student?.class?.gradeLevel || '';
    studentSubjects(student?.subjects || []);
    dialog.showModal();
    byId('student-lrn').focus();
  }
  byId('student-class').addEventListener('change', function () {
    const cls = options.classes.find((item) => item._id === this.value);
    byId('student-grade-level').value = cls?.gradeLevel || '';
    studentSubjects();
  });
  byId('register-student').addEventListener('click', () => run(() => openStudent()));
  byId('cancel-student').addEventListener('click', () => {
    if (!saving) dialog.close();
  });
  dialog.addEventListener('cancel', (event) => {
    if (saving) event.preventDefault();
  });
  byId('student-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    if (saving) return;
    const body = {
      lrn: byId('student-lrn').value.trim(),
      firstName: byId('student-first-name').value.trim(),
      lastName: byId('student-last-name').value.trim(),
      middleName: byId('student-middle-name').value.trim(),
      gender: byId('student-gender').value,
      gradeLevel: byId('student-grade-level').value.trim(),
      classId: byId('student-class').value,
      subjectIds: Array.from(
        byId('student-subjects').querySelectorAll('input:checked'),
        (input) => input.value
      ),
      version: editing?.recordVersion || 0
    };
    saving = true;
    byId('student-form-fields').disabled = true;
    byId('save-student').disabled = true;
    UI.status('student-form-status', 'Saving student…');
    try {
      await UI.api('/adviser/students' + (editing ? '/' + editing._id : ''), {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(body)
      });
      dialog.close();
      document.dispatchEvent(new Event('student-record-saved'));
      await run(loadRegistry);
    } catch (error) {
      UI.status('student-form-status', error.message, true);
    } finally {
      saving = false;
      byId('student-form-fields').disabled = false;
      byId('save-student').disabled = false;
    }
  });
  function filterStudents(delay = 0) {
    clearTimeout(searchTimer);
    registryRequest++;
    page = 1;
    byId('students-prev').disabled = true;
    byId('students-next').disabled = true;
    if (delay) searchTimer = setTimeout(() => run(loadRegistry), delay);
    else run(loadRegistry);
  }
  byId('student-search').addEventListener('input', () => filterStudents(200));
  byId('student-class-filter').addEventListener('change', () => filterStudents());
  byId('student-search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    filterStudents();
  });
  byId('students-prev').addEventListener('click', () => {
    if (page > 1) {
      page--;
      run(loadRegistry);
    }
  });
  byId('students-next').addEventListener('click', () => {
    if (page < pages) {
      page++;
      run(loadRegistry);
    }
  });

  async function loadMonitor() {
    const data = await UI.api('/adviser/monitor');
    const subjects = byId('monitor-subjects'),
      students = byId('monitor-students');
    subjects.replaceChildren();
    students.replaceChildren();
    data.subjects.forEach((subject) =>
      UI.row(subjects, [
        subject.name,
        subject.className,
        subject.teacherName,
        subject.complete + ' / ' + subject.total,
        UI.badge(subject.status)
      ])
    );
    if (!data.subjects.length)
      UI.empty(subjects, 'No subjects assigned to your advisory class.', 5);
    data.students.forEach((student) => {
      const name = UI.node('div', student.name);
      name.appendChild(UI.node('span', student.className, 'workflow-detail'));
      const list = UI.node('ul', undefined, 'workflow-grade-list');
      student.subjects.forEach((subject) => {
        const item = UI.node(
          'li',
          subject.name + ': ' + (subject.grade === null ? 'Incomplete' : subject.grade + '%') + ' '
        );
        item.appendChild(UI.badge(subject.status));
        list.appendChild(item);
      });
      if (!student.subjects.length) list.textContent = 'No subject enrollment';
      const print = UI.button('Final report', async () => {
        print.disabled = true;
        try {
          UI.showReport(
            await UI.api('/adviser/students/' + student.studentId + '/final-report'),
            'final'
          );
        } catch (error) {
          UI.status('adviser-tool-status', error.message, true);
        } finally {
          print.disabled = !student.readyForReport;
        }
      });
      print.disabled = !student.readyForReport;
      const action = UI.node('div');
      action.appendChild(print);
      if (!student.readyForReport)
        action.appendChild(
          UI.node('span', 'Waiting for complete, finalized grades', 'workflow-detail')
        );
      UI.row(students, [student.lrn || 'Not recorded', name, list, action]);
    });
    if (!data.students.length) UI.empty(students, 'No students in your advisory class.', 4);
    document.querySelector('[data-adviser-tab="requests"]').textContent =
      'Pending Approvals' + (data.pendingRequests ? ' (' + data.pendingRequests + ')' : '');
  }
  async function loadRequests() {
    const requests = (await UI.api('/adviser/edit-requests')).filter(
      (request) => request.status === 'pending'
    );
    const tbody = byId('edit-requests-tbody');
    tbody.replaceChildren();
    requests.forEach((request) => {
      const subject = UI.node('div', request.subject?.name || 'Subject unavailable');
      subject.appendChild(UI.node('span', request.class?.name || '', 'workflow-detail'));
      const reason = UI.node('div', request.reason);
      reason.appendChild(
        UI.node('span', new Date(request.createdAt).toLocaleString(), 'workflow-detail')
      );
      const actions = UI.node('div', undefined, 'workflow-actions');
      if (request.status === 'pending') {
        ['approved', 'rejected'].forEach((decision) =>
          actions.appendChild(
            UI.button(decision === 'approved' ? 'Approve reopening' : 'Reject', () => {
              review = { request, decision };
              byId('review-description').textContent =
                (decision === 'approved' ? 'Reopen ' : 'Keep locked: ') +
                (request.subject?.name || 'subject') +
                '. Request: ' +
                request.reason;
              byId('review-note').value = '';
              UI.status('review-status', '');
              byId('confirm-review').textContent =
                decision === 'approved' ? 'Approve reopening' : 'Reject request';
              byId('review-dialog').showModal();
            })
          )
        );
      } else {
        actions.textContent = request.reviewNote || 'Reviewed';
        actions.appendChild(
          UI.node(
            'span',
            (request.reviewedBy?.username || 'Class adviser') +
              (request.reviewedAt ? ' · ' + new Date(request.reviewedAt).toLocaleString() : ''),
            'workflow-detail'
          )
        );
      }
      UI.row(tbody, [
        subject,
        request.requestedBy?.username || 'Teacher unavailable',
        reason,
        UI.badge(request.status),
        actions
      ]);
    });
    if (!requests.length)
      UI.empty(tbody, 'No pending grade-edit requests for your advisory classes.', 5);
  }
  byId('cancel-review').addEventListener('click', () => {
    if (!saving) byId('review-dialog').close();
  });
  byId('review-dialog').addEventListener('cancel', (event) => {
    if (saving) event.preventDefault();
  });
  byId('review-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving || !review) return;
    saving = true;
    byId('confirm-review').disabled = true;
    try {
      await UI.api('/adviser/edit-requests/' + review.request._id + '/review', {
        method: 'POST',
        body: JSON.stringify({ decision: review.decision, note: byId('review-note').value.trim() })
      });
      byId('review-dialog').close();
      await run(loadRequests);
    } catch (error) {
      UI.status('review-status', error.message, true);
    } finally {
      saving = false;
      byId('confirm-review').disabled = false;
    }
  });
  async function loadMyRequests() {
    const requests = await UI.api('/teacher/edit-requests');
    const tbody = byId('my-requests-tbody');
    tbody.replaceChildren();
    requests.forEach((request) => {
      const subject = UI.node('div', request.subject?.name || 'Subject unavailable');
      subject.appendChild(UI.node('span', request.class?.name || '', 'workflow-detail'));
      const reason = UI.node('div', request.reason);
      reason.appendChild(
        UI.node('span', new Date(request.createdAt).toLocaleString(), 'workflow-detail')
      );
      const review = UI.node(
        'div',
        request.reviewNote || (request.status === 'pending' ? 'Awaiting class adviser' : 'Reviewed')
      );
      review.appendChild(UI.node('span', request.reviewedBy?.username || '', 'workflow-detail'));
      const link = UI.node('a', 'Open gradebook', 'filter-btn');
      link.href = 'grade-entry.html?subject=' + encodeURIComponent(request.subject?._id || '');
      UI.row(tbody, [subject, reason, UI.badge(request.status), review, link]);
    });
    if (!requests.length)
      UI.empty(tbody, 'You have no grade-edit requests for your assigned subjects.', 5);
  }
  async function loadHistory() {
    const entries = await UI.api('/adviser/modification-history');
    const tbody = byId('history-tbody');
    tbody.replaceChildren();
    const labels = {
      'grades-saved': 'Grades saved',
      'grades-finalized': 'Grades finalized',
      'reopening-requested': 'Reopening requested',
      'reopening-approved': 'Reopening approved',
      'reopening-rejected': 'Reopening rejected'
    };
    entries.forEach((entry) =>
      UI.row(tbody, [
        new Date(entry.createdAt).toLocaleString(),
        entry.subject?.name || 'Subject unavailable',
        labels[entry.action] || entry.action,
        entry.actor?.username || 'Account unavailable'
      ])
    );
    if (!entries.length) UI.empty(tbody, 'No grade modifications recorded yet.', 4);
  }
  function loadTab() {
    if (tab === 'registry') {
      run(loadRegistry);
      if (!options)
        loadOptions().catch((error) =>
          UI.status(
            'adviser-tool-status',
            'Student list is available, but class choices could not load: ' + error.message,
            true
          )
        );
    } else if (tab === 'monitor') run(loadMonitor);
    else if (tab === 'requests') run(loadRequests);
    else if (tab === 'my-requests') run(loadMyRequests);
    else if (tab === 'history') run(loadHistory);
  }
  function selectTab(value) {
    tab = value;
    const section = byId(
      value === 'monitor'
        ? 'view-reports'
        : ['requests', 'my-requests', 'history'].includes(value)
          ? 'view-requests'
          : 'view-homeroom'
    );
    section.querySelectorAll('[data-adviser-tab]').forEach((item) => {
      const active = item.dataset.adviserTab === tab;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    section.querySelectorAll('[data-adviser-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.adviserPanel !== tab;
    });
    UI.status('adviser-tool-status', '');
    loadTab();
  }
  document
    .querySelectorAll('[data-adviser-tab]')
    .forEach((button) =>
      button.addEventListener('click', () => selectTab(button.dataset.adviserTab))
    );
  document.addEventListener('adviser-view-changed', (event) => {
    const view = event.detail.view;
    if (view === 'reports') selectTab('monitor');
    else if (view === 'requests')
      selectTab(
        ['requests', 'history', ...(event.detail.teaching ? ['my-requests'] : [])].includes(tab)
          ? tab
          : 'requests'
      );
    else if (view === 'homeroom')
      selectTab(['homeroom', 'teachers', 'registry'].includes(tab) ? tab : 'homeroom');
    else {
      tab = '';
      UI.status('adviser-tool-status', '');
      byId('retry-adviser-tool').hidden = true;
    }
  });
  byId('refresh-monitor').addEventListener('click', () => run(loadMonitor));
  byId('refresh-requests').addEventListener('click', () => run(loadRequests));
  byId('refresh-my-requests').addEventListener('click', () => run(loadMyRequests));
  byId('refresh-history').addEventListener('click', () => run(loadHistory));
  byId('retry-adviser-tool').addEventListener('click', loadTab);
});
