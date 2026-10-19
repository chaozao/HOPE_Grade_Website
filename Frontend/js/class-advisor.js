// Based on the subject-teacher dashboard, with separate advisory and teaching views.
document.addEventListener('DOMContentLoaded', function () {
  const token = getToken();
  const payload = token && getPayload(token);
  if (!payload) {
    clearToken();
    window.location.href = 'index.html';
    return;
  }
  if (payload.role !== 'teacher') {
    window.location.href = 'admin-dashboard.html';
    return;
  }

  const byId = function (id) {
    return document.getElementById(id);
  };
  byId('user-name').textContent = payload.username;
  byId('welcome-message').textContent =
    'Welcome, ' + payload.username + '. Your homeroom and teaching assignments at a glance.';
  byId('logout-btn').addEventListener('click', confirmLogout);

  let subjects = [];
  let ready = false;
  const classBrowser = ClassBrowser.create(byId('class-browser'));

  function showStatus(id, message, isError) {
    const status = byId(id);
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle('is-error', Boolean(isError));
  }

  // Use textContent for names and other data supplied by the server.
  function appendRow(tbody, values) {
    const row = document.createElement('tr');
    values.forEach(function (value) {
      const cell = document.createElement('td');
      cell.textContent = value ?? '—';
      row.appendChild(cell);
    });
    tbody.appendChild(row);
    return row;
  }

  function emptyRow(tbody, message, columns) {
    const row = appendRow(tbody, [message]);
    row.firstElementChild.colSpan = columns;
  }

  function renderHomeroom(advisory) {
    byId('homeroom-empty').hidden = Boolean(advisory);
    byId('homeroom-content').hidden = !advisory;
    byId('stat-homeroom').textContent = advisory ? advisory.class.name : 'Not assigned';
    byId('stat-students').textContent = advisory ? advisory.students.length : '—';
    if (!advisory) return;
    byId('manage-section-subjects').disabled = false;
    byId('manage-section-subjects').onclick = () => SectionSubjects.open(advisory.class._id);
    HomeroomRoster.load(advisory.class);
    const teachers = byId('homeroom-subjects-tbody');
    teachers.replaceChildren();
    advisory.subjects.forEach(function (subject) {
      appendRow(teachers, [
        subject.name,
        subject.teacher ? subject.teacher.username : 'Not assigned',
        subject.teacher ? subject.teacher.email : '—'
      ]);
    });
    if (!advisory.subjects.length)
      emptyRow(teachers, 'No subjects have been assigned to this homeroom yet.', 3);
  }

  function showView() {
    let view = window.location.hash.slice(1) || 'dashboard';
    if (
      !['dashboard', 'homeroom', 'class', 'requests', 'reports'].includes(view) ||
      (view === 'class' && !subjects.length)
    ) {
      view = 'dashboard';
      // Keep a requested Class view pending until assignments have loaded.
      if (ready) window.history.replaceState(null, '', '#dashboard');
    }
    document.querySelectorAll('.advisor-panel').forEach(function (panel) {
      panel.hidden = panel.id !== 'view-' + view;
    });
    document.querySelectorAll('[data-view]').forEach(function (link) {
      const active = link.dataset.view === view;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    const title = {
      dashboard: 'Dashboard',
      homeroom: 'Homeroom',
      class: 'Class',
      requests: 'Grade Edit Request',
      reports: 'Final Grade Reports'
    }[view];
    document.title = title + ' — Hope Workspace';
    document.dispatchEvent(
      new CustomEvent('adviser-view-changed', { detail: { view, teaching: subjects.length > 0 } })
    );
    if (view === 'class' && ready) classBrowser.show();
  }

  async function init() {
    byId('retry-btn').hidden = true;
    showStatus('page-status', 'Loading your assignments…');
    // Each assignment can load even if the other endpoint fails.
    const results = await Promise.allSettled([
      getAdvisorClass(token),
      fetchTeacherData(token, '/teacher/my-subjects')
    ]);
    const errors = [];
    if (results[0].status === 'fulfilled' && !results[0].value) {
      window.location.replace('dashboard.html');
      return;
    }
    if (results[0].status === 'fulfilled') renderHomeroom(results[0].value);
    else errors.push('Could not load homeroom: ' + results[0].reason.message);

    subjects = results[1].status === 'fulfilled' ? results[1].value : [];
    if (results[1].status === 'rejected')
      errors.push('Could not load teaching assignments: ' + results[1].reason.message);
    byId('class-nav').hidden = !subjects.length;
    if (results[0].status === 'fulfilled') rememberWorkspace(token, true, subjects.length > 0);
    byId('my-requests-tab').hidden = !subjects.length;
    byId('assignments-note').hidden = !subjects.length;
    const assigned = byId('assigned-subjects-tbody');
    assigned.replaceChildren();
    subjects.forEach(function (subject) {
      AcademicUI.row(assigned, [
        subject.name,
        subject.className,
        subject.studentCount ?? '?',
        AcademicUI.badge(subject.gradeStatus || 'draft')
      ]);
    });
    if (!subjects.length)
      emptyRow(
        assigned,
        results[1].status === 'rejected'
          ? 'Teaching assignments could not load. Use Retry loading assignments.'
          : 'No subjects assigned. You can manage your advisory class in Homeroom.',
        4
      );
    byId('stat-subjects').textContent = results[1].status === 'fulfilled' ? subjects.length : '—';
    byId('teaching-note').textContent =
      results[1].status === 'rejected'
        ? 'Teaching assignments unavailable'
        : subjects.length
          ? 'Subjects you teach'
          : 'No subject-teaching assignments';
    classBrowser.setSubjects(subjects);
    ready = true;
    showStatus('page-status', errors.join(' '), errors.length > 0);
    byId('retry-btn').hidden = !errors.length;
    showView();
  }

  byId('retry-btn').addEventListener('click', init);
  window.addEventListener('hashchange', showView);
  document.addEventListener('student-record-saved', init);
  document.addEventListener('section-subjects-saved', init);
  showView();
  init();
});
