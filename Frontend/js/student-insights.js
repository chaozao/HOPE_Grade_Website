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

    const componentLabels = { hw1: 'HW 1', quiz1: 'Quiz 1', midterm: 'Midterm', project1: 'Project 1' };

    async function loadInsights(subjectId) {
        const data = await authFetch('http://localhost:3000/teacher/subjects/' + subjectId + '/insights');

        document.getElementById('distribution-subtitle').textContent =
            data.subjectName + ' — ' + data.className + ' (' + data.totalStudents + ' students)';

        // ---- Distribution bar ----
        const total = data.totalStudents || 1;
        const segments = [
            { key: 'A', className: 'seg-a', count: data.distribution.A },
            { key: 'B', className: 'seg-b', count: data.distribution.B },
            { key: 'C', className: 'seg-c', count: data.distribution.C },
            { key: 'F', className: 'seg-f', count: data.distribution.F },
            { key: 'Not graded', className: 'seg-notgraded', count: data.distribution.notGraded }
        ];

        const bar = document.getElementById('distribution-bar');
        bar.innerHTML = segments
            .filter(function (s) { return s.count > 0; })
            .map(function (s) {
                const pct = (s.count / total) * 100;
                return '<div class="distribution-segment ' + s.className + '" style="width:' + pct + '%"></div>';
            }).join('');

        const legend = document.getElementById('distribution-legend');
        legend.innerHTML = segments.map(function (s) {
            return '<div class="legend-item"><span class="legend-dot ' + s.className + '"></span>' +
                s.key + ': ' + s.count + '</div>';
        }).join('');

        // ---- Component averages ----
        const fields = ['hw1', 'quiz1', 'midterm', 'project1'];
        const values = fields.map(function (f) { return data.componentAverages[f]; }).filter(function (v) { return v !== null; });
        const lowest = values.length > 0 ? Math.min.apply(null, values) : null;

        const cardsContainer = document.getElementById('component-cards');
        cardsContainer.innerHTML = fields.map(function (field) {
            const avg = data.componentAverages[field];
            const isLowest = avg !== null && avg === lowest && values.length > 1;
            return '<div class="component-card' + (isLowest ? ' lowest' : '') + '">' +
                '<span class="label">' + componentLabels[field] + '</span>' +
                '<span class="value">' + (avg !== null ? avg + '%' : '—') + '</span>' +
                '</div>';
        }).join('');

        // ---- At-risk list ----
        const atRiskContainer = document.getElementById('at-risk-list');
        if (data.atRisk.length === 0) {
            atRiskContainer.innerHTML = '<p class="no-risk-message">No students are currently below 75%. 🎉</p>';
        } else {
            atRiskContainer.innerHTML = data.atRisk.map(function (student) {
                return '<div class="at-risk-row">' +
                    '<span class="at-risk-name">' + student.name + '</span>' +
                    '<span class="grade-pill grade-f">' + student.weightedGrade + '%</span>' +
                    '</div>';
            }).join('');
        }
    }

    async function init() {
        const subjects = await authFetch('http://localhost:3000/teacher/my-subjects');

        if (subjects.length === 0) {
            document.getElementById('no-subjects-message').classList.remove('hidden');
            return;
        }

        document.getElementById('insights-content').classList.remove('hidden');

        const select = document.getElementById('subject-select');
        select.innerHTML = subjects.map(function (s) {
            return '<option value="' + s._id + '">' + s.name + ' — ' + s.className + '</option>';
        }).join('');

        select.addEventListener('change', function () {
            loadInsights(select.value);
        });

        loadInsights(subjects[0]._id);
    }

    init();
});