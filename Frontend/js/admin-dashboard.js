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
        clearToken(); // from auth.js — clears both storage spots
        window.location.href = 'index.html';
    });

    async function authFetch(url, options = {}) {
        options.headers = Object.assign({}, options.headers, {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        });
        const response = await fetch(url, options);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Something went wrong.');
        return data;
    }

    // ---------- TAB SWITCHING ----------
    const navItems = document.querySelectorAll('.nav-item');
    const tabPanels = document.querySelectorAll('.tab-panel');

    navItems.forEach(function (btn) {
        btn.addEventListener('click', function () {
            navItems.forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');

            tabPanels.forEach(function (panel) { panel.classList.add('hidden'); });
            document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
        });
    });

    // ---------- LOAD TEACHERS ----------
    async function loadTeachers() {
        const teachers = await authFetch('http://localhost:3000/admin/teachers');
        const tbody = document.getElementById('teachers-tbody');
        tbody.innerHTML = '';

        teachers.forEach(function (teacher) {
            const row = document.createElement('tr');
            row.innerHTML =
                '<td>' + (teacher.username || '—') + '</td>' +
                '<td>' + teacher.email + '</td>' +
                '<td>' + (teacher.advisoryClass || '—') + '</td>' +
                '<td>' + (teacher.subjectsTaught.length ? teacher.subjectsTaught.join(', ') : '—') + '</td>' +
                '<td><span class="status-pill ' + (teacher.isActive ? 'status-active' : 'status-inactive') + '">' +
                    (teacher.isActive ? 'Active' : 'Deactivated') + '</span></td>' +
                '<td><button class="btn-small toggle-status" data-id="' + teacher._id + '">' +
                    (teacher.isActive ? 'Deactivate' : 'Reactivate') + '</button></td>';
            tbody.appendChild(row);
        });

        const teacherSelect = document.getElementById('new-subject-teacher');
        teacherSelect.innerHTML = teachers.map(function (t) {
            return '<option value="' + t._id + '">' + (t.username || t.email) + '</option>';
        }).join('');

        const adviserSelect = document.getElementById('new-class-adviser');
        adviserSelect.innerHTML = teachers.map(function (t) {
            return '<option value="' + t._id + '">' + (t.username || t.email) + '</option>';
        }).join('');

        document.querySelectorAll('.toggle-status').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                await authFetch('http://localhost:3000/admin/teachers/' + btn.dataset.id + '/deactivate', { method: 'PATCH' });
                loadTeachers();
            });
        });
    }

    // ---------- LOAD CLASSES ----------
    async function loadClasses() {
        const classes = await authFetch('http://localhost:3000/admin/classes');
        const tbody = document.getElementById('classes-tbody');
        tbody.innerHTML = '';

        classes.forEach(function (cls) {
            const row = document.createElement('tr');
            row.innerHTML =
                '<td>' + cls.name + '</td>' +
                '<td>' + (cls.adviser ? cls.adviser.username : '—') + '</td>' +
                '<td>' + (cls.adviser ? cls.adviser.email : '—') + '</td>';
            tbody.appendChild(row);
        });

        const classSelect = document.getElementById('new-subject-class');
        classSelect.innerHTML = classes.map(function (c) {
            return '<option value="' + c._id + '">' + c.name + '</option>';
        }).join('');
    }

    // ---------- LOAD SUBJECTS ----------
    async function loadSubjects() {
        const subjects = await authFetch('http://localhost:3000/admin/subjects');
        const tbody = document.getElementById('subjects-tbody');
        tbody.innerHTML = '';

        subjects.forEach(function (subject) {
            const row = document.createElement('tr');
            row.innerHTML =
                '<td>' + subject.name + '</td>' +
                '<td>' + (subject.class ? subject.class.name : '—') + '</td>' +
                '<td>' + (subject.teacher ? subject.teacher.username : '—') + '</td>';
            tbody.appendChild(row);
        });
    }

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

    // ---------- FORM: Add Teacher ----------
    document.getElementById('form-add-teacher').addEventListener('submit', async function (e) {
        e.preventDefault();
        try {
            await authFetch('http://localhost:3000/admin/teachers', {
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
            await authFetch('http://localhost:3000/admin/classes', {
                method: 'POST',
                body: JSON.stringify({
                    name: document.getElementById('new-class-name').value,
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
            await authFetch('http://localhost:3000/admin/subjects', {
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

    // ---------- INITIAL LOAD ----------
    loadTeachers();
    loadClasses();
    loadSubjects();
});