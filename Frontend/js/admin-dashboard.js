document.addEventListener('DOMContentLoaded', function () {
  const token = getToken(); // from auth.js — checks sessionStorage AND localStorage

  if (!token) {
    window.location.href = 'index.html';
    return;
  }

  const payload = JSON.parse(atob(token.split('.')[1]));

  if (payload.role !== 'admin') {
    window.location.href = 'dashboard.html';
    return;
  }

  document.getElementById('user-name').textContent = payload.username;

  document.getElementById('logout-btn').addEventListener('click', function () {
    confirmLogout(); // from auth.js — asks "Are you sure?" first, then signs out
  });

  async function authFetch(url, options = {}) {
    const headers = { Authorization: 'Bearer ' + token };

    // Every existing call in this file sends JSON, so Content-Type stays
    // forced to that by default - EXCEPT a photo upload (FormData), which
    // needs the browser to set its own multipart boundary automatically.
    // Forcing "application/json" on that request would silently break it.
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    options.headers = Object.assign({}, options.headers, headers);
    const controller = new AbortController();
    const timeout = setTimeout(function () {
      controller.abort();
    }, 15000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Something went wrong.');
      return data;
    } catch (error) {
      if (error.name === 'AbortError')
        throw new Error('The server took too long to respond. Please try again.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ---------- TAB SWITCHING ----------
  const navItems = document.querySelectorAll('.nav-item');
  const tabPanels = document.querySelectorAll('.tab-panel');

  function showTab() {
    const wantedTab = window.location.hash.slice(1);
    const selected =
      Array.from(navItems).find(function (btn) {
        return btn.dataset.tab === wantedTab;
      }) || navItems[0];
    navItems.forEach(function (btn) {
      const active = btn === selected;
      btn.classList.toggle('active', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    tabPanels.forEach(function (panel) {
      panel.classList.toggle('hidden', panel.id !== 'tab-' + selected.dataset.tab);
    });
  }

  navItems.forEach(function (btn) {
    btn.addEventListener('click', function () {
      // The URL survives both normal and cache-bypassing refreshes.
      window.location.hash = btn.dataset.tab;
      showTab();
    });
  });
  window.addEventListener('hashchange', showTab);
  showTab();

  // ---------- LOAD TEACHERS ----------
  let cachedTeachers = null;
  let cachedSubjects = null;

  function showTableError(message) {
    const banner = document.getElementById('teacher-status');
    banner.textContent = message;
    banner.classList.add('is-error');
    banner.hidden = false;
    document.getElementById('retry-teachers').hidden = false;
  }

  async function loadTeachers() {
    // Accounts must render even when class/subject detail requests fail or hang.
    try {
      const teachers = await authFetch(API_BASE_URL + '/admin/teachers');
      if (!Array.isArray(teachers)) throw new Error('The server returned an invalid teacher list.');
      renderTeachers(teachers);
      cachedTeachers = teachers;
    } catch (error) {
      showTableError(
        'Could not load teacher accounts. ' +
          error.message +
          ' Use Retry loading tables to try again.'
      );
      if (cachedTeachers === null) {
        const tbody = document.getElementById('teachers-tbody');
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 7;
        cell.textContent = 'Teacher accounts could not be loaded. Please retry.';
        row.appendChild(cell);
        tbody.replaceChildren(row);
      }
    }
  }

  function renderTeachers(teachers) {
    const assignmentsByTeacher = new Map();
    (cachedSubjects || []).forEach(function (subject) {
      const teacherId = subject.teacher?._id;
      if (!teacherId) return;
      if (!assignmentsByTeacher.has(teacherId)) assignmentsByTeacher.set(teacherId, []);
      assignmentsByTeacher.get(teacherId).push(subject);
    });
    const tbody = document.getElementById('teachers-tbody');
    const rows = document.createDocumentFragment();

    teachers.forEach(function (teacher) {
      const row = document.createElement('tr');
      function cell(text, className) {
        const td = document.createElement('td');
        if (text !== undefined) td.textContent = text;
        if (className) td.className = className;
        row.appendChild(td);
        return td;
      }
      cell(teacher.username || '—', 'teacher-name');
      cell(teacher.email, 'teacher-email');
      const rolesCell = cell();
      const roles = document.createElement('div');
      roles.className = 'teacher-role-list';
      const roleLabels = { 'class-advisor': 'Class Adviser', 'subject-teacher': 'Subject Teacher' };
      const teacherRoles = Array.isArray(teacher.teacherRoles)
        ? teacher.teacherRoles
        : [
            teacher.advisoryClass && 'class-advisor',
            teacher.subjectsTaught?.length && 'subject-teacher'
          ].filter(Boolean);
      teacherRoles.forEach(function (role) {
        if (!roleLabels[role]) return;
        const badge = document.createElement('span');
        badge.className = 'teacher-role-badge role-' + role;
        badge.textContent = roleLabels[role];
        roles.appendChild(badge);
      });
      if (!roles.childElementCount) {
        roles.textContent = 'Not assigned';
        roles.classList.add('assignment-empty');
      }
      rolesCell.appendChild(roles);
      cell(
        teacher.advisoryClass || 'Not assigned',
        teacher.advisoryClass ? 'teacher-homeroom' : 'assignment-empty'
      );
      const assignmentsCell = cell(undefined, 'teacher-assignments');
      // The teacher response already includes subject names. Render those
      // immediately, then enrich the rows when the subject list arrives.
      const fallback = (Array.isArray(teacher.subjectsTaught) ? teacher.subjectsTaught : []).map(
        (name) => ({ name })
      );
      const assignments = (
        cachedSubjects === null ? fallback : assignmentsByTeacher.get(teacher._id) || []
      ).sort(function (a, b) {
        return (
          String(a.name || '').localeCompare(String(b.name || '')) ||
          String(a.class?.name || '').localeCompare(String(b.class?.name || ''))
        );
      });
      if (!assignments.length) {
        assignmentsCell.textContent = 'Not assigned';
        assignmentsCell.classList.add('assignment-empty');
      } else {
        const count = document.createElement('p');
        count.className = 'assignment-count';
        count.textContent =
          assignments.length + (assignments.length === 1 ? ' assignment' : ' assignments');
        const list = document.createElement('ul');
        list.className = 'teaching-assignment-list';
        list.id = 'assignments-' + teacher._id;
        assignments.forEach(function (assignment, index) {
          const item = document.createElement('li');
          item.hidden = index >= 2;
          const name = document.createElement('span');
          name.className = 'assignment-subject';
          name.textContent = assignment.name || 'Unnamed subject';
          const section = document.createElement('span');
          section.className = 'assignment-class';
          section.textContent =
            assignment.class?.name ||
            (cachedSubjects === null ? 'Class details not loaded' : 'Class unavailable');
          item.append(name, section);
          list.appendChild(item);
        });
        assignmentsCell.append(count, list);
        if (assignments.length > 2) {
          const toggle = document.createElement('button');
          toggle.type = 'button';
          toggle.className = 'assignment-toggle';
          toggle.setAttribute('aria-controls', list.id);
          toggle.setAttribute('aria-expanded', 'false');
          toggle.textContent = '+' + (assignments.length - 2) + ' more';
          toggle.addEventListener('click', function () {
            const expanded = toggle.getAttribute('aria-expanded') !== 'true';
            toggle.setAttribute('aria-expanded', String(expanded));
            toggle.textContent = expanded ? 'Show less' : '+' + (assignments.length - 2) + ' more';
            list.classList.toggle('is-expanded', expanded);
            Array.from(list.children).forEach(function (item, index) {
              item.hidden = !expanded && index >= 2;
            });
          });
          assignmentsCell.appendChild(toggle);
        }
      }
      const status = document.createElement('span');
      status.className = 'status-pill ' + (teacher.isActive ? 'status-active' : 'status-inactive');
      status.textContent = teacher.isActive ? 'Active' : 'Deactivated';
      cell().appendChild(status);
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'edit-teacher-roles';
      action.dataset.id = teacher._id;
      action.title = 'Edit roles and assignments';
      action.setAttribute('aria-label', 'Edit roles for ' + (teacher.username || teacher.email));
      action.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-pencil" viewBox="0 0 16 16" aria-hidden="true"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325"/></svg>';
      cell().appendChild(action);
      rows.appendChild(row);
    });
    if (!teachers.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 7;
      cell.className = 'assignment-empty';
      cell.textContent = 'No teachers yet. Add a teacher to get started.';
      row.appendChild(cell);
      rows.appendChild(row);
    }
    tbody.replaceChildren(rows);

    const teacherSelect = document.getElementById('new-subject-teacher');
    teacherSelect.innerHTML =
      '<option value="">Assign later</option>' +
      teachers
        .map(function (t) {
          return '<option value="' + t._id + '">' + (t.username || t.email) + '</option>';
        })
        .join('');

    const adviserSelect = document.getElementById('new-class-adviser');
    adviserSelect.innerHTML =
      '<option value="">Assign later</option>' +
      teachers
        .filter(function (t) {
          return !t.advisoryClass;
        })
        .map(function (t) {
          return '<option value="' + t._id + '">' + (t.username || t.email) + '</option>';
        })
        .join('');
  }

  // ---------- LOAD CLASSES ----------
  let cachedClasses = [];
  const classFilters = [
    ['filter-class-name', 'name', 'All classes'],
    ['filter-class-grade', 'gradeLevel', 'All grade levels'],
    ['filter-class-section', 'section', 'All sections']
  ];
  function setFilterOptions(id, entries, placeholder) {
    const select = document.getElementById(id);
    const previous = select.value;
    select.replaceChildren(
      new Option(placeholder, ''),
      ...entries.map(([value, label]) => new Option(label, value))
    );
    select.value = entries.some(([value]) => value === previous) ? previous : '';
  }
  function classLabel(cls) {
    return [cls.name, cls.gradeLevel, cls.section].filter(Boolean).join(' - ');
  }
  function addCells(row, values) {
    values.forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value || '—';
      row.appendChild(cell);
    });
  }
  function showEmptyTable(tbody, columns, message) {
    if (tbody.children.length) return;
    const row = document.createElement('tr');
    addCells(row, [message]);
    row.firstElementChild.colSpan = columns;
    tbody.appendChild(row);
  }
  classFilters.forEach(([id]) =>
    document.getElementById(id).addEventListener('change', renderClasses)
  );
  document.getElementById('filter-subject-class').addEventListener('change', renderSubjects);

  async function loadClasses() {
    const classes = await authFetch(API_BASE_URL + '/admin/classes');
    if (!Array.isArray(classes)) throw new Error('The server returned an invalid class list.');
    cachedClasses = classes;
    classFilters.forEach(([id, field, placeholder]) => {
      const values = [...new Set(classes.map((cls) => cls[field]).filter(Boolean))].sort((a, b) =>
        a === 'Kinder' ? -1 : b === 'Kinder' ? 1 : a.localeCompare(b, undefined, { numeric: true })
      );
      setFilterOptions(
        id,
        values.map((value) => [value, value]),
        placeholder
      );
    });
    setFilterOptions(
      'filter-subject-class',
      classes.map((cls) => [cls._id, classLabel(cls)]),
      'All classes and sections'
    );
    renderClasses();
    renderSubjects();
    const classSelect = document.getElementById('new-subject-class');
    classSelect.replaceChildren(...classes.map((cls) => new Option(classLabel(cls), cls._id)));
  }

  function renderClasses() {
    document.getElementById('clear-all-classes').disabled = !cachedClasses.length;
    const tbody = document.getElementById('classes-tbody');
    tbody.innerHTML = '';
    const classes = cachedClasses.filter((cls) =>
      classFilters.every(([id, field]) => {
        const value = document.getElementById(id).value;
        return !value || cls[field] === value;
      })
    );
    classes.forEach(function (cls) {
      const row = document.createElement('tr');
      addCells(row, [cls.name, cls.gradeLevel, cls.section, cls.adviser?.username]);
      const action = document.createElement('td');
      const manage = AcademicUI.button('Manage subjects', () => SectionSubjects.open(cls._id));
      manage.className = 'btn-secondary';
      action.appendChild(manage);
      row.appendChild(action);
      appendClearAction(row, 'classes', cls._id, classLabel(cls));
      tbody.appendChild(row);
    });

    showEmptyTable(tbody, 6, 'No classes match your selections.');
  }

  // ---------- LOAD SUBJECTS ----------
  async function loadSubjects() {
    const subjects = await authFetch(API_BASE_URL + '/admin/subjects');
    if (!Array.isArray(subjects)) throw new Error('The server returned an invalid subject list.');
    cachedSubjects = subjects;
    if (cachedTeachers !== null) renderTeachers(cachedTeachers);
    renderSubjects();
  }

  function renderSubjects() {
    if (cachedSubjects === null) return;
    document.getElementById('clear-all-subjects').disabled = !cachedSubjects.length;
    const tbody = document.getElementById('subjects-tbody');
    tbody.innerHTML = '';
    const selectedClass = document.getElementById('filter-subject-class').value;
    const subjects = cachedSubjects.filter(
      (subject) => !selectedClass || subject.class?._id === selectedClass
    );
    subjects.forEach(function (subject) {
      const row = document.createElement('tr');
      const cls = cachedClasses.find((cls) => cls._id === subject.class?._id) || subject.class;
      addCells(row, [subject.name, cls && classLabel(cls), subject.teacher?.username]);
      appendClearAction(
        row,
        'subjects',
        subject._id,
        subject.name + ' — ' + (cls ? classLabel(cls) : 'Class unavailable')
      );
      tbody.appendChild(row);
    });
    showEmptyTable(tbody, 4, 'No subjects match your selection.');
  }

  const clearDialog = document.getElementById('clear-data-dialog');
  const clearInput = document.getElementById('clear-data-confirmation');
  const clearSubmit = document.getElementById('confirm-clear-data');
  const clearCancel = document.getElementById('cancel-clear-data');
  let clearSelection = null,
    clearing = false;
  function appendClearAction(row, kind, id, label) {
    const cell = document.createElement('td');
    const button = AcademicUI.button('Clear Data', () => openClearData(kind, [id], label));
    button.className = 'btn-clear-data';
    button.setAttribute('aria-label', 'Clear data for ' + label);
    cell.appendChild(button);
    row.appendChild(cell);
  }
  function openClearData(kind, ids, label) {
    if (!ids.length) return;
    clearSelection = { kind, ids };
    clearInput.value = '';
    clearSubmit.disabled = true;
    document.getElementById('clear-data-error').hidden = true;
    document.getElementById('clear-data-target').textContent = label;
    document.getElementById('clear-data-description').textContent =
      kind === 'classes'
        ? 'Removes the selected classes, their students, subjects, activities, grades, edit requests, history, and teacher assignments. Teacher accounts are kept.'
        : 'Removes the selected subjects, activities, grades, enrollments, edit requests, history, and subject teacher assignments. Classes, student records, and teacher accounts are kept.';
    clearDialog.showModal();
    clearCancel.focus();
  }
  ['classes', 'subjects'].forEach((kind) => {
    document.getElementById('clear-all-' + kind).addEventListener('click', () => {
      const records = kind === 'classes' ? cachedClasses : cachedSubjects || [];
      openClearData(
        kind,
        records.map((item) => item._id),
        'ALL ' + records.length + ' ' + kind + ' — includes records hidden by table filters'
      );
    });
  });
  clearInput.addEventListener('input', () => {
    clearSubmit.disabled = clearing || clearInput.value !== 'CLEAR';
  });
  clearCancel.addEventListener('click', () => {
    if (!clearing) clearDialog.close();
  });
  clearDialog.addEventListener('cancel', (event) => {
    if (clearing) event.preventDefault();
  });
  document.getElementById('clear-data-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (clearing || !clearSelection || clearInput.value !== 'CLEAR') return;
    clearing = true;
    clearSubmit.disabled = clearCancel.disabled = clearInput.disabled = true;
    clearSubmit.textContent = 'Clearing…';
    const errorBox = document.getElementById('clear-data-error');
    errorBox.hidden = true;
    try {
      await authFetch(API_BASE_URL + '/admin/clear-data/' + clearSelection.kind, {
        method: 'POST',
        body: JSON.stringify({ ids: clearSelection.ids, confirmation: clearInput.value })
      });
      const removed = new Set(clearSelection.ids);
      if (clearSelection.kind === 'classes') {
        cachedClasses = cachedClasses.filter((item) => !removed.has(item._id));
        if (cachedSubjects)
          cachedSubjects = cachedSubjects.filter((item) => !removed.has(item.class?._id));
      } else if (cachedSubjects)
        cachedSubjects = cachedSubjects.filter((item) => !removed.has(item._id));
      renderClasses();
      renderSubjects();
      clearDialog.close();
      await reloadTables();
      alert(
        'Data cleared. The selected blocks and linked records have been removed from admin, adviser, and teacher records.'
      );
    } catch (error) {
      errorBox.textContent =
        error.message + ' Refresh the tables to check their current state before retrying.';
      errorBox.hidden = false;
    } finally {
      clearing = false;
      clearSubmit.disabled = clearInput.value !== 'CLEAR';
      clearCancel.disabled = clearInput.disabled = false;
      clearSubmit.textContent = 'Clear Data Permanently';
    }
  });

  document.addEventListener('section-subjects-saved', () => {
    loadSubjects().catch((error) => showTableError(error.message));
    loadTeachers().catch((error) => showTableError(error.message));
  });

  // ---------- MODALS ----------
  function setupModal(openBtnId, modalId) {
    const modal = document.getElementById(modalId);
    document.getElementById(openBtnId).addEventListener('click', function () {
      modal.classList.remove('hidden');
    });
    modal.querySelector('.modal-cancel').addEventListener('click', function () {
      modal.classList.add('hidden');
    });
  }

  setupModal('open-add-teacher', 'modal-add-teacher');
  setupModal('open-add-class', 'modal-add-class');
  setupModal('open-add-subject', 'modal-add-subject');

  const gradePicker = document.getElementById('grade-picker');
  const gradeSelect = document.getElementById('new-class-grade-level');
  const gradeSummary = gradePicker.querySelector('summary');
  gradeSelect.addEventListener('change', function () {
    document.getElementById('grade-picker-value').textContent =
      gradeSelect.value || 'Choose grade level';
  });
  function closeGradePicker() {
    gradePicker.open = false;
    gradeSummary.focus();
  }
  gradeSelect.addEventListener('click', function () {
    if (gradeSelect.value) closeGradePicker();
  });
  gradeSelect.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      closeGradePicker();
    }
  });
  gradeSelect.addEventListener('invalid', function () {
    gradePicker.open = true;
  });
  document.getElementById('form-add-class').addEventListener('reset', function () {
    document.getElementById('grade-picker-value').textContent = 'Choose grade level';
    gradePicker.open = false;
  });

  const teacherModal = document.getElementById('modal-add-teacher');
  const teacherPassword = document.getElementById('new-teacher-password');
  const passwordToggle = document.getElementById('toggle-teacher-password');
  function setTeacherPasswordVisible(visible) {
    teacherPassword.type = visible ? 'text' : 'password';
    passwordToggle.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    passwordToggle.setAttribute('aria-pressed', String(visible));
    passwordToggle.querySelector('i').className = visible
      ? 'bi bi-eye-fill'
      : 'bi bi-eye-slash-fill';
  }
  passwordToggle.addEventListener('click', function () {
    setTeacherPasswordVisible(teacherPassword.type === 'password');
  });
  document.getElementById('open-add-teacher').addEventListener('click', function () {
    setTeacherPasswordVisible(false);
  });
  teacherModal.addEventListener('click', function (event) {
    if (event.target === teacherModal) {
      teacherModal.classList.add('hidden');
      setTeacherPasswordVisible(false);
      document.getElementById('open-add-teacher').focus();
    }
  });

  // ---------- FORM: Add Teacher ----------
  document.getElementById('form-add-teacher').addEventListener('submit', async function (e) {
    e.preventDefault();
    try {
      await authFetch(API_BASE_URL + '/admin/teachers', {
        method: 'POST',
        body: JSON.stringify({
          username: document.getElementById('new-teacher-username').value,
          email: document.getElementById('new-teacher-email').value,
          password: document.getElementById('new-teacher-password').value
        })
      });
      document.getElementById('modal-add-teacher').classList.add('hidden');
      e.target.reset();
      loadTeachers();
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------- FORM: Add Class ----------
  document.getElementById('form-add-class').addEventListener('submit', async function (e) {
    e.preventDefault();
    try {
      await authFetch(API_BASE_URL + '/admin/classes', {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('new-class-name').value,
          gradeLevel: document.getElementById('new-class-grade-level').value.trim(),
          section: document.getElementById('new-class-section').value.trim(),
          adviserId: document.getElementById('new-class-adviser').value
        })
      });
      document.getElementById('modal-add-class').classList.add('hidden');
      e.target.reset();
      loadClasses();
      loadTeachers();
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------- FORM: Add Subject ----------
  document.getElementById('form-add-subject').addEventListener('submit', async function (e) {
    e.preventDefault();
    try {
      await authFetch(API_BASE_URL + '/admin/subjects', {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('new-subject-name').value,
          classId: document.getElementById('new-subject-class').value,
          teacherId: document.getElementById('new-subject-teacher').value
        })
      });
      document.getElementById('modal-add-subject').classList.add('hidden');
      e.target.reset();
      loadSubjects();
      loadTeachers();
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------- MY PROFILE TAB: sub-tab switching (Photo / Name / Password) ----------
  const settingsTabs = document.querySelectorAll('.settings-tab');
  const settingsPanels = document.querySelectorAll('.settings-panel');

  settingsTabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      settingsTabs.forEach(function (t) {
        t.classList.remove('active');
      });
      tab.classList.add('active');

      settingsPanels.forEach(function (p) {
        p.classList.add('hidden');
      });
      document.getElementById('tab-' + tab.dataset.tab).classList.remove('hidden');
    });
  });

  function showProfileBanner(message, type) {
    const banner = document.getElementById('profile-form-banner');
    banner.textContent = message;
    banner.className =
      'settings-banner ' +
      (type === 'success' ? 'settings-banner-success' : 'settings-banner-error');
    banner.hidden = false;
  }

  function renderAvatar(photoPath) {
    const avatarPreview = document.getElementById('avatar-preview');
    if (photoPath) {
      avatarPreview.innerHTML = '<img src="' + API_BASE_URL + photoPath + '" alt="Profile photo">';
    } else {
      avatarPreview.innerHTML = '<i class="bi bi-person-fill"></i>';
    }
  }

  async function loadOwnProfile() {
    try {
      const me = await authFetch(API_BASE_URL + '/me');
      document.getElementById('username').value = me.username;
      renderAvatar(me.photo);
    } catch (err) {
      showProfileBanner('Could not load your profile: ' + err.message, 'error');
    }
  }

  document.getElementById('photo-input').addEventListener('change', async function () {
    const file = this.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('photo', file);

    try {
      const me = await authFetch(API_BASE_URL + '/me/photo', {
        method: 'POST',
        body: formData
        // No Content-Type header here on purpose - the browser sets the
        // correct multipart boundary automatically for FormData uploads.
        // authFetch always adds one, so we remove it again for this request only.
      });
      renderAvatar(me.photo);
      showProfileBanner('Profile photo updated.', 'success');
    } catch (err) {
      showProfileBanner(err.message, 'error');
    }
  });

  document.getElementById('name-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();

    try {
      const me = await authFetch(API_BASE_URL + '/me', {
        method: 'PUT',
        body: JSON.stringify({ username })
      });
      document.getElementById('username').value = me.username;
      showProfileBanner(
        'Name updated. Other pages will show it after you next sign in.',
        'success'
      );
    } catch (err) {
      showProfileBanner(err.message, 'error');
    }
  });

  document.getElementById('password-form').addEventListener('submit', async function (e) {
    e.preventDefault();

    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value.trim();
    const confirmNewPassword = document.getElementById('confirm-new-password').value.trim();

    const validationError = validateNewPassword(newPassword, confirmNewPassword); // from auth.js
    if (validationError) {
      showProfileBanner(validationError, 'error');
      return;
    }

    try {
      await authFetch(API_BASE_URL + '/me/password', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword, newPassword })
      });
      showProfileBanner('Password changed successfully.', 'success');
      e.target.reset();
    } catch (err) {
      showProfileBanner(err.message, 'error');
    }
  });

  // ---------- INITIAL LOAD ----------
  document.addEventListener('teacher-roles-saved', function () {
    Promise.all([loadTeachers(), loadClasses(), loadSubjects()]).catch(function (error) {
      const banner = document.getElementById('teacher-status');
      banner.textContent =
        'Roles saved, but the tables could not refresh. Reload this page. ' + error.message;
      banner.classList.add('is-error');
      banner.hidden = false;
    });
  });
  async function reloadTables() {
    const retry = document.getElementById('retry-teachers');
    retry.disabled = true;
    retry.hidden = true;
    document.getElementById('teacher-status').hidden = true;
    await Promise.allSettled([
      loadTeachers(),
      loadClasses().catch((error) =>
        showTableError(
          'Could not load class details. Teacher accounts remain available. ' + error.message
        )
      ),
      loadSubjects().catch((error) =>
        showTableError(
          'Could not load teaching assignment details. Teacher accounts remain available. ' +
            error.message
        )
      )
    ]);
    retry.disabled = false;
  }
  document.getElementById('retry-teachers').addEventListener('click', reloadTables);
  reloadTables();
  loadOwnProfile();
});
