document.addEventListener('DOMContentLoaded', function () {
    const token = getToken();
    if (!token || getPayload(token)?.role !== 'admin') return;
    const byId = id => document.getElementById(id);
    const modal = byId('modal-assign-roles');
    const teacherSelect = byId('roles-teacher');
    const homeroomSelect = byId('roles-homeroom');
    const advisorCheck = byId('role-advisor');
    const subjectCheck = byId('role-subject-teacher');
    let teachers = [], classes = [], subjects = [];
    let saving = false;
    let loadVersion = 0;

    function status(message, error = false) {
        byId('roles-status').textContent = message;
        byId('roles-status').hidden = !message;
        byId('roles-status').classList.toggle('is-error', error);
    }

    async function request(path, options = {}) {
        const response = await fetch(API_BASE_URL + path, {
            ...options,
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
        });
        let data;
        try { data = await response.json(); }
        catch { throw new Error('The server could not load Assign Roles. Make sure the updated backend is running.'); }
        if (!response.ok) throw new Error(data.error || 'Could not save assignments.');
        return data;
    }

    function updateRoleFields() {
        byId('advisor-assignment').hidden = !advisorCheck.checked;
        homeroomSelect.disabled = !advisorCheck.checked;
        homeroomSelect.required = advisorCheck.checked;
        byId('subject-assignments').hidden = !subjectCheck.checked;
    }

    function selectTeacher() {
        const teacher = teachers.find(item => item._id === teacherSelect.value);
        advisorCheck.checked = Boolean(teacher?.advisoryClassId);
        subjectCheck.checked = Boolean(teacher?.subjectIds?.length);
        homeroomSelect.replaceChildren(new Option('Select a homeroom', ''));
        classes.forEach(function (item) {
            const occupied = item.adviser && item.adviser._id !== teacherSelect.value;
            const option = new Option(item.name + (occupied ? ' — assigned to ' + item.adviser.username : ''), item._id);
            option.disabled = Boolean(occupied);
            homeroomSelect.appendChild(option);
        });
        homeroomSelect.value = teacher?.advisoryClassId || '';
        byId('roles-subjects').replaceChildren();
        subjects.forEach(function (item) {
            const label = document.createElement('label');
            label.className = 'role-choice';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = item._id;
            input.checked = Boolean(teacher?.subjectIds?.includes(item._id));
            input.disabled = Boolean(item.teacher && item.teacher._id !== teacherSelect.value);
            const text = document.createElement('span');
            text.textContent = item.name + ' — ' + (item.class?.name || 'No class') + (input.disabled ? ' (assigned to ' + item.teacher.username + ')' : '');
            label.append(input, text);
            byId('roles-subjects').appendChild(label);
        });
        if (!subjects.length) byId('roles-subjects').textContent = 'No subjects yet. Create a subject in the Subjects menu first.';
        updateRoleFields();
        status('');
    }

    async function loadAssignments() {
        const version = ++loadVersion;
        byId('roles-fields').disabled = true;
        byId('save-roles').disabled = true;
        byId('retry-roles').hidden = true;
        status('Loading assignments…');
        try {
            const data = await Promise.all([
                request('/admin/teachers'), request('/admin/classes'), request('/admin/subjects')
            ]);
            if (version !== loadVersion) return;
            [teachers, classes, subjects] = data;
            teacherSelect.replaceChildren();
            teachers.forEach(item => teacherSelect.appendChild(new Option(item.username + ' — ' + item.email, item._id)));
            if (!teachers.length) {
                status('No teacher accounts yet. Add a teacher first.');
                return;
            }
            selectTeacher();
            byId('roles-fields').disabled = false;
            byId('save-roles').disabled = false;
            teacherSelect.focus();
        } catch (error) {
            if (version !== loadVersion) return;
            status('Could not load assignments: ' + error.message, true);
            byId('retry-roles').hidden = false;
        }
    }

    function close() {
        if (saving) return;
        ++loadVersion;
        modal.classList.add('hidden');
        byId('open-assign-roles').focus();
    }

    byId('open-assign-roles').addEventListener('click', function () {
        modal.classList.remove('hidden');
        byId('cancel-roles').focus();
        loadAssignments();
    });
    byId('cancel-roles').addEventListener('click', close);
    byId('retry-roles').addEventListener('click', loadAssignments);
    teacherSelect.addEventListener('change', selectTeacher);
    advisorCheck.addEventListener('change', updateRoleFields);
    subjectCheck.addEventListener('change', updateRoleFields);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') close();
        if (event.key !== 'Tab') return;
        const controls = Array.from(modal.querySelectorAll('button, select, input')).filter(item => !item.matches(':disabled') && item.getClientRects().length);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    byId('form-assign-roles').addEventListener('submit', async function (event) {
        event.preventDefault();
        if (saving || byId('roles-fields').disabled) return;
        const roles = [];
        if (advisorCheck.checked) roles.push('class-advisor');
        if (subjectCheck.checked) roles.push('subject-teacher');
        const subjectIds = subjectCheck.checked ? Array.from(byId('roles-subjects').querySelectorAll('input:checked:not(:disabled)'), input => input.value) : [];
        if (subjectCheck.checked && !subjectIds.length) { status('Select at least one teaching subject.', true); return; }
        const body = { roles, advisoryClassId: advisorCheck.checked ? homeroomSelect.value : null, subjectIds };
        saving = true;
        byId('roles-fields').disabled = true;
        byId('save-roles').disabled = true;
        byId('cancel-roles').disabled = true;
        status('Saving roles…');
        let saved = false;
        try {
            const result = await request('/admin/teachers/' + encodeURIComponent(teacherSelect.value) + '/roles', { method: 'PUT', body: JSON.stringify(body) });
            saved = true;
            const banner = byId('teacher-status');
            banner.textContent = result.message;
            banner.hidden = false;
            banner.classList.remove('is-error');
            document.dispatchEvent(new Event('teacher-roles-saved'));
        } catch (error) {
            status('Could not save roles: ' + error.message, true);
        } finally {
            saving = false;
            byId('roles-fields').disabled = false;
            byId('save-roles').disabled = false;
            byId('cancel-roles').disabled = false;
            if (saved) close();
        }
    });
});
