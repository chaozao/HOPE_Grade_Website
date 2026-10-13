window.AcademicUI = (function () {
    async function api(path, options = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            const response = await fetch(API_BASE_URL + path, { ...options, signal: controller.signal,
                headers: { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'application/json' } });
            if (response.status === 401) { clearToken(); window.location.href = 'index.html'; throw new Error('Please sign in again.'); }
            const data = await response.json();
            if (!response.ok) { const error = new Error(data.error || 'Request failed.'); error.status = response.status; throw error; }
            return data;
        } catch (error) {
            if (error.name === 'AbortError') throw new Error('The server took too long to respond. Please retry.');
            throw error;
        } finally { clearTimeout(timeout); }
    }
    function node(tag, text, className) {
        const el = document.createElement(tag);
        if (text !== undefined) el.textContent = text;
        if (className) el.className = className;
        return el;
    }
    function row(tbody, values) {
        const tr = node('tr');
        values.forEach(value => { const td = node('td'); if (value instanceof Node) td.appendChild(value); else td.textContent = value ?? '—'; tr.appendChild(td); });
        tbody.appendChild(tr);
        return tr;
    }
    function empty(tbody, message, columns) { row(tbody, [message]).firstElementChild.colSpan = columns; }
    function status(id, message, error = false) {
        const el = document.getElementById(id);
        el.textContent = message; el.hidden = !message; el.classList.toggle('is-error', error);
    }
    function badge(value) { return node('span', value[0].toUpperCase() + value.slice(1), 'workflow-badge ' + value); }
    function button(label, action) { const el = node('button', label, 'filter-btn'); el.type = 'button'; el.addEventListener('click', action); return el; }
    function showReport(data, type) {
        let dialog = document.getElementById('report-dialog');
        if (!dialog) { dialog = node('dialog'); dialog.id = 'report-dialog'; document.body.appendChild(dialog); }
        dialog.replaceChildren();
        const tools = node('div', undefined, 'report-tools');
        tools.append(button('Close', () => dialog.close()), button('Print / Save PDF', () => window.print()));
        dialog.appendChild(tools);
        const article = node('article');
        const final = type === 'final';
        article.append(node('h1', final ? 'Final Grade Report' : 'Subject Grade Summary', 'report-heading'));
        const meta = node('div', undefined, 'report-meta');
        const details = final ? [
            ['Student', [data.student.lastName + ',', data.student.firstName, data.student.middleName || data.student.middleInitial].filter(Boolean).join(' ')],
            ['LRN', data.student.lrn || 'Not recorded'], ['Gender', data.student.gender], ['Grade level', data.student.gradeLevel || 'Not recorded'],
            ['Class / section', data.className], ['Class adviser', data.adviserName]
        ] : [['Subject', data.subjectName], ['Class / section', data.className], ['Status', data.gradeStatus === 'finalized' ? 'Finalized' : 'Draft — not final'], ['Students', data.totalStudents]];
        details.forEach(([label, value]) => meta.appendChild(node('p', label + ': ' + value)));
        article.appendChild(meta);
        const table = node('table', undefined, 'report-table');
        const head = node('thead'), header = node('tr');
        (final ? ['Subject', 'Final grade', 'Remarks'] : ['LRN', 'Student', 'HW 1', 'Quiz 1', 'Midterm', 'Project 1', 'Grade']).forEach(label => header.appendChild(node('th', label)));
        head.appendChild(header); table.appendChild(head);
        const body = node('tbody');
        if (final) {
            data.subjects.forEach(subject => row(body, [subject.name, subject.grade + '%', subject.grade >= 75 ? 'Passed' : 'Below passing']));
        } else {
            data.roster.forEach(student => row(body, [student.lrn || 'Not recorded', student.lastName + ', ' + student.firstName, ...['hw1', 'quiz1', 'midterm', 'project1'].map(field => student.scores[field] ?? '—'), student.weightedGrade === null ? 'Incomplete' : student.weightedGrade + '%']));
        }
        table.appendChild(body); article.appendChild(table);
        if (final) article.append(node('p', 'General average: ' + data.generalAverage + '%'), node('p', 'Class adviser signature: ________________________', 'report-note'));
        article.appendChild(node('p', 'Generated: ' + new Date(data.generatedAt || Date.now()).toLocaleString() + '. Grades use the current gradebook assessment weights; the general average is the mean of enrolled subjects.', 'report-note'));
        dialog.appendChild(article); dialog.showModal();
    }
    return { api, node, row, empty, status, badge, button, showReport };
})();
