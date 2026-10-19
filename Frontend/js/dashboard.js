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
    byId = (id) => document.getElementById(id);
  const classBrowser = ClassBrowser.create(byId('class-browser'));
  let subjects = [],
    ready = false,
    tab = 'my-requests',
    requestVersion = 0;
  byId('user-name').textContent = payload.username;
  byId('logout-btn').addEventListener('click', confirmLogout);
  async function loadTab() {
    const version = ++requestVersion;
    UI.status('teacher-status', 'Loading...');
    byId('retry-teacher').hidden = true;
    try {
      await (tab === 'history' ? loadHistory() : loadMyRequests());
      if (version === requestVersion) UI.status('teacher-status', '');
    } catch (error) {
      if (version !== requestVersion) return;
      UI.status('teacher-status', error.message, true);
      byId('retry-teacher').hidden = false;
    }
  }
  function selectTab(value) {
    tab = value;
    document.querySelectorAll('[data-adviser-tab]').forEach((button) => {
      const active = button.dataset.adviserTab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('[data-adviser-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.adviserPanel !== tab;
    });
    loadTab();
  }
  function showView() {
    if (!ready) return;
    let view = location.hash.slice(1) || 'dashboard';
    if (
      !['dashboard', 'class', 'requests'].includes(view) ||
      (view === 'class' && !subjects.length)
    ) {
      view = 'dashboard';
      history.replaceState(null, '', location.pathname + location.search);
    }
    requestVersion++;
    UI.status('teacher-status', '');
    byId('retry-teacher').hidden = true;
    ['dashboard', 'class', 'requests'].forEach((id) => {
      byId('view-' + id).hidden = id !== view;
    });
    renderTeacherNavigation(subjects.length > 0);
    if (view === 'requests') selectTab(tab);
    if (view === 'class') classBrowser.show();
  }
  window.addEventListener('hashchange', showView);
  document
    .querySelectorAll('[data-adviser-tab]')
    .forEach((button) =>
      button.addEventListener('click', () => selectTab(button.dataset.adviserTab))
    );
  byId('refresh-my-requests').addEventListener('click', loadTab);
  byId('refresh-history').addEventListener('click', loadTab);
  byId('retry-teacher').addEventListener('click', () => (ready ? loadTab() : init()));
  async function init() {
    try {
      if (await getAdvisorClass(token)) {
        location.replace('class-advisor.html');
        return;
      }
      subjects = await UI.api('/teacher/my-subjects');
      rememberWorkspace(token, false, subjects.length > 0);
      const tbody = byId('assigned-subjects-tbody');
      tbody.replaceChildren();
      classBrowser.setSubjects(subjects);
      subjects.forEach((subject) => {
        const link = UI.node('a', subject.name);
        link.href = '#class';
        UI.row(tbody, [
          link,
          subject.className,
          subject.studentCount ?? 0,
          UI.badge(subject.gradeStatus || 'draft')
        ]);
      });
      if (!subjects.length)
        UI.empty(
          tbody,
          'You are not currently assigned to teach any subject. Contact your admin if this looks wrong.',
          4
        );
      ready = true;
      showView();
    } catch (error) {
      if (!getToken()) return;
      if (workspaceHint(token)?.adviser) {
        location.replace('class-advisor.html');
        return;
      }
      const status = document.querySelector('.workspace-load-state');
      if (status)
        status.firstChild.textContent = 'Could not load your workspace: ' + error.message + ' ';
    }
  }
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
    const entries = await UI.api('/teacher/modification-history');
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
  init();
});
