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

    const byId = function (id) { return document.getElementById(id); };
    byId('user-name').textContent = payload.username;
    byId('welcome-message').textContent = 'Welcome, ' + payload.username + '. Your homeroom and teaching assignments at a glance.';
    byId('logout-btn').addEventListener('click', confirmLogout);

    let subjects = [];
    let ready = false;
    let rosterRequest = 0;
    const select = byId('subject-select');

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
            appendRow(teachers, [subject.name, subject.teacher ? subject.teacher.username : 'Not assigned', subject.teacher ? subject.teacher.email : '—']);
        });
        if (!advisory.subjects.length) emptyRow(teachers, 'No subjects have been assigned to this homeroom yet.', 3);
    }

    function letterFor(score) {
        if (score >= 90) return { letter: 'A', className: 'grade-a' };
        if (score >= 80) return { letter: 'B', className: 'grade-b' };
        if (score >= 75) return { letter: 'C', className: 'grade-c' };
        return { letter: 'F', className: 'grade-f' };
    }

    async function loadRoster() {
        const subjectId = select.value;
        if (!ready || !subjects.some(function (subject) { return subject._id === subjectId; })) return;
        const request = ++rosterRequest;
        byId('overview-content').hidden = true;
        byId('retry-roster-btn').hidden = true;
        showStatus('roster-status', 'Loading grades…');
        byId('grade-entry-link').href = 'grade-entry.html?subject=' + encodeURIComponent(subjectId);
        byId('grade-finalization-link').href = 'grade-entry.html?subject=' + encodeURIComponent(subjectId) + '#finalization';
        byId('insights-link').href = 'student-insights.html?subject=' + encodeURIComponent(subjectId);
        try {
            const data = await fetchTeacherData(token, '/teacher/subjects/' + encodeURIComponent(subjectId) + '/roster');
            if (request !== rosterRequest) return;
            byId('stat-average').textContent = data.classAverage !== null ? data.classAverage + '%' : '—';
            byId('stat-average-note').textContent = data.subjectName;
            byId('stat-roster').textContent = data.totalStudents + ' student' + (data.totalStudents === 1 ? '' : 's');
            byId('stat-roster-note').textContent = data.subjectName;
            byId('stat-passing').textContent = data.passingRate !== null ? data.passingRate + '%' : '—';
            const ungraded = data.roster.filter(function (student) { return student.weightedGrade === null; }).length;
            byId('stat-passing-note').textContent = !data.roster.length ? 'No students yet' : ungraded ? ungraded + ' not yet graded' : 'All graded';
            const tbody = byId('grades-tbody');
            tbody.replaceChildren();
            data.roster.forEach(function (student) {
                const row = appendRow(tbody, [student.lastName + ', ' + student.firstName, student.scores.hw1, student.scores.quiz1, student.scores.midterm, student.scores.project1]);
                const cell = document.createElement('td');
                const pill = document.createElement('span');
                pill.className = 'grade-pill';
                if (student.weightedGrade === null) {
                    pill.textContent = 'Not graded';
                } else {
                    const grade = letterFor(student.weightedGrade);
                    pill.classList.add(grade.className);
                    pill.textContent = student.weightedGrade + '% (' + grade.letter + ')';
                }
                cell.appendChild(pill);
                row.appendChild(cell);
            });
            if (!data.roster.length) emptyRow(tbody, 'No students are enrolled in this class yet.', 6);
            byId('overview-content').hidden = false;
            showStatus('roster-status', '');
        } catch (error) {
            if (request !== rosterRequest) return;
            showStatus('roster-status', 'Could not load grades: ' + error.message, true);
            byId('retry-roster-btn').hidden = false;
        }
    }

    function showView() {
        let view = window.location.hash.slice(1) || 'dashboard';
        if (!['dashboard', 'homeroom', 'class', 'requests', 'reports'].includes(view) || (view === 'class' && !subjects.length)) {
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
        const title = { dashboard: 'Dashboard', homeroom: 'Homeroom', class: 'Class', requests: 'Grade Edit Request', reports: 'Final Grade Reports' }[view];
        document.title = title + ' — Hope Workspace';
        document.dispatchEvent(new CustomEvent('adviser-view-changed', { detail: { view, teaching: subjects.length > 0 } }));
        if (view === 'class' && ready) loadRoster();
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
        if (results[1].status === 'rejected') errors.push('Could not load teaching assignments: ' + results[1].reason.message);
        byId('class-nav').hidden = !subjects.length;
        if (results[0].status === 'fulfilled') rememberWorkspace(token, true, subjects.length > 0);
        byId('my-requests-tab').hidden = !subjects.length;
        byId('assignments-note').hidden = !subjects.length;
        const assigned = byId('assigned-subjects-tbody');
        assigned.replaceChildren();
        subjects.forEach(function (subject) {
            AcademicUI.row(assigned, [subject.name, subject.className, subject.studentCount ?? '?', AcademicUI.badge(subject.gradeStatus || 'draft')]);
        });
        if (!subjects.length) emptyRow(assigned, results[1].status === 'rejected' ? 'Teaching assignments could not load. Use Retry loading assignments.' : 'No subjects assigned. You can manage your advisory class in Homeroom.', 4);
        byId('stat-subjects').textContent = results[1].status === 'fulfilled' ? subjects.length : '—';
        byId('teaching-note').textContent = results[1].status === 'rejected' ? 'Teaching assignments unavailable' : subjects.length ? 'Subjects you teach' : 'No subject-teaching assignments';
        const previousSubject = select.value;
        select.replaceChildren();
        subjects.forEach(function (subject) {
            const option = document.createElement('option');
            option.value = subject._id;
            option.textContent = subject.name + ' — ' + subject.className;
            select.appendChild(option);
        });
        if (subjects.some(function (subject) { return subject._id === previousSubject; })) select.value = previousSubject;
        select.disabled = !subjects.length;
        ready = true;
        showStatus('page-status', errors.join(' '), errors.length > 0);
        byId('retry-btn').hidden = !errors.length;
        showView();
    }

    select.addEventListener('change', loadRoster);
    byId('retry-btn').addEventListener('click', init);
    byId('retry-roster-btn').addEventListener('click', loadRoster);
    window.addEventListener('hashchange', showView);
    document.addEventListener('student-record-saved', init);
    document.addEventListener('section-subjects-saved', init);
    showView();
    init();
});
