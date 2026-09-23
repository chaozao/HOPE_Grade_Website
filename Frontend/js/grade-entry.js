document.addEventListener('DOMContentLoaded', function () {
    const token = getToken(); // from auth.js — checks sessionStorage AND localStorage

    if (!token) {
        window.location.href = 'index.html';
        return;
    }

    const payload = JSON.parse(atob(token.split('.')[1]));

    if (payload.role !== 'teacher') {
        window.location.href = 'admin-dashboard.html';
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

    function letterFor(score) {
        if (score >= 90) return { letter: 'A', className: 'grade-a' };
        if (score >= 80) return { letter: 'B', className: 'grade-b' };
        if (score >= 75) return { letter: 'C', className: 'grade-c' };
        return { letter: 'F', className: 'grade-f' };
    }

    function computeWeighted(scores) {
        const { hw1, quiz1, midterm, project1 } = scores;
        if (hw1 == null || quiz1 == null || midterm == null || project1 == null) return null;
        const weightedSum = (hw1 * 0.15) + (quiz1 * 0.20) + (midterm * 0.30) + (project1 * 0.15);
        return Number((weightedSum / 0.80).toFixed(1));
    }

    function validateInput(value) {
        if (value === '') return { state: 'empty', message: '' };
        const num = Number(value);
        if (isNaN(num)) return { state: 'error', message: 'Enter a number.' };
        if (num < 0 || num > 100) return { state: 'error', message: '0-100 only.' };
        return { state: 'valid', message: '' };
    }

    let currentSubjectId = null;

    async function loadRoster(subjectId) {
        currentSubjectId = subjectId;
        const data = await authFetch(API_BASE_URL + '/teacher/subjects/' + subjectId + '/roster');
        document.getElementById('page-subtitle').textContent =
            'Input individual scores for "' + data.subjectName + '" (' + data.totalStudents + ' students).';

        const tbody = document.getElementById('entry-tbody');
        tbody.innerHTML = '';

        data.roster.forEach(function (student) {
            const row = document.createElement('tr');
            row.className = 'entry-row';
            row.dataset.studentId = student.studentId;

            const fields = ['hw1', 'quiz1', 'midterm', 'project1'];

            row.innerHTML =
                '<td>' + student.lastName + ', ' + student.firstName + '</td>' +
                fields.map(function (field) {
                    const val = student.scores[field] ?? '';
                    return '<td><input type="number" class="grade-input" min="0" max="100" data-field="' + field + '" value="' + val + '"></td>';
                }).join('') +
                '<td class="current-grade-cell"></td>';

            tbody.appendChild(row);

            function refreshRowGrade() {
                const scores = {};
                let hasError = false;

                fields.forEach(function (field) {
                    const input = row.querySelector('[data-field="' + field + '"]');
                    const result = validateInput(input.value);
                    input.classList.toggle('state-error', result.state === 'error');
                    if (result.state === 'error') hasError = true;
                    scores[field] = input.value === '' ? null : Number(input.value);
                });

                row.classList.toggle('has-error', hasError);

                const gradeCell = row.querySelector('.current-grade-cell');
                if (hasError) {
                    gradeCell.innerHTML = '<span class="grade-pill grade-f">Fix errors</span>';
                    return;
                }

                const weighted = computeWeighted(scores);
                if (weighted === null) {
                    gradeCell.innerHTML = '<span class="grade-pill">Incomplete</span>';
                } else {
                    const grade = letterFor(weighted);
                    gradeCell.innerHTML = '<span class="grade-pill ' + grade.className + '">' + weighted + '% (' + grade.letter + ')</span>';
                }
            }

            fields.forEach(function (field) {
                row.querySelector('[data-field="' + field + '"]').addEventListener('input', refreshRowGrade);
            });

            refreshRowGrade();
        });
    }

    async function init() {
        const subjects = await authFetch(API_BASE_URL + '/teacher/my-subjects');
        if (subjects.length === 0) {
            document.getElementById('no-subjects-message').classList.remove('hidden');
            return;
        }

        document.getElementById('table-section').classList.remove('hidden');

        const select = document.getElementById('subject-select');
        select.innerHTML = subjects.map(function (s) {
            return '<option value="' + s._id + '">' + s.name + ' — ' + s.className + '</option>';
        }).join('');

        select.addEventListener('change', function () {
            loadRoster(select.value);
        });

        loadRoster(subjects[0]._id);
    }

    document.getElementById('save-btn').addEventListener('click', async function () {
        const rows = document.querySelectorAll('.entry-row');
        const hasErrors = document.querySelectorAll('.grade-input.state-error').length > 0;

        if (hasErrors) {
            alert('Please fix the highlighted scores before saving.');
            return;
        }

        const grades = Array.from(rows).map(function (row) {
            const scores = {};
            ['hw1', 'quiz1', 'midterm', 'project1'].forEach(function (field) {
                const input = row.querySelector('[data-field="' + field + '"]');
                scores[field] = input.value === '' ? null : Number(input.value);
            });
            return { studentId: row.dataset.studentId, scores };
        });

        try {
            await authFetch(API_BASE_URL + '/teacher/subjects/' + currentSubjectId + '/grades', {
                method: 'PUT',
                body: JSON.stringify({ grades })
            });
            alert('Grades saved successfully!');
        } catch (err) {
            alert('Error saving: ' + err.message);
        }
    });

    init();
});