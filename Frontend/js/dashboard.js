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

    async function authFetch(url) {
        const response = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + token }
        });
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

    async function loadRoster(subjectId) {
        const data = await authFetch(API_BASE_URL + '/teacher/subjects/' + subjectId + '/roster');

        // Stat cards
        document.getElementById('stat-average').textContent = data.classAverage !== null ? data.classAverage + '%' : '—';
        document.getElementById('stat-average-note').textContent = data.subjectName;

        document.getElementById('stat-roster').textContent = data.totalStudents + ' student' + (data.totalStudents === 1 ? '' : 's');
        document.getElementById('stat-roster-note').textContent = data.subjectName;

        document.getElementById('stat-passing').textContent = data.passingRate !== null ? data.passingRate + '%' : '—';
        const ungraded = data.roster.filter(function (r) { return r.weightedGrade === null; }).length;
        document.getElementById('stat-passing-note').textContent = ungraded > 0 ? ungraded + ' not yet graded' : 'All graded';

        // Table
        const tbody = document.getElementById('grades-tbody');
        tbody.innerHTML = '';

        data.roster.forEach(function (student) {
            const row = document.createElement('tr');
            const fullName = student.lastName + ', ' + student.firstName;

            let gradeCell;
            if (student.weightedGrade === null) {
                gradeCell = '<span class="grade-pill">Not graded</span>';
            } else {
                const grade = letterFor(student.weightedGrade);
                gradeCell = '<span class="grade-pill ' + grade.className + '">' + student.weightedGrade + '% (' + grade.letter + ')</span>';
            }

            row.innerHTML =
                '<td>' + fullName + '</td>' +
                '<td>' + (student.scores.hw1 ?? '—') + '</td>' +
                '<td>' + (student.scores.quiz1 ?? '—') + '</td>' +
                '<td>' + (student.scores.midterm ?? '—') + '</td>' +
                '<td>' + (student.scores.project1 ?? '—') + '</td>' +
                '<td>' + gradeCell + '</td>';

            tbody.appendChild(row);
        });
    }

    async function init() {
        const subjects = await authFetch(API_BASE_URL + '/teacher/my-subjects');

        if (subjects.length === 0) {
            document.getElementById('no-subjects-message').classList.remove('hidden');
            return;
        }

        document.getElementById('overview-content').classList.remove('hidden');

        const select = document.getElementById('subject-select');
        select.innerHTML = subjects.map(function (s) {
            return '<option value="' + s._id + '">' + s.name + ' — ' + s.className + '</option>';
        }).join('');

        select.addEventListener('change', function () {
            loadRoster(select.value);
        });

        // Load the first subject by default
        loadRoster(subjects[0]._id);
    }

    init();
});