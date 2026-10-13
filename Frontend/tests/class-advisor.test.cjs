// Run with: node --test Frontend/tests/class-advisor.test.cjs
// Uses local Chrome (or CHROME_PATH) and fixture responses; no database writes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const vm = require('node:vm');

test('API configuration follows the website host for local and LAN access', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../js/config.js'), 'utf8');
    for (const [page, expected] of [
        ['http://localhost/HOPE_Grade_Website/Frontend/index.html', 'http://localhost:3000'],
        ['http://127.0.0.1:5500/Frontend/index.html', 'http://127.0.0.1:3000'],
        ['http://172.16.0.2:5500/index.html', 'http://172.16.0.2:3000'],
        ['file:///C:/xampp/htdocs/HOPE_Grade_Website/Frontend/index.html', 'http://localhost:3000']
    ]) {
        assert.equal(vm.runInNewContext(source + '\nAPI_BASE_URL;', { window: { location: new URL(page) } }), expected);
    }
});

test('advisor assignment, navigation, login, and recovery flows in Chrome', { timeout: 90000 }, async (t) => {
    const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    assert.ok(fs.existsSync(chrome), 'Set CHROME_PATH to a Chrome executable.');
    const root = path.resolve(__dirname, '..');
    let mode = 'advisor';
    let teacherDashboardVisits = 0;
    let savedRoles = { roles: [], advisoryClassId: null, subjectIds: [] };
    let failRoleSave = false;
    let roleSaveCount = 0;
    let releaseSubjectResponse;
    const academicFixture = require('./academic-fixtures.cjs')();
    const tokenFor = (role, isAdviser) => 'test.' + Buffer.from(JSON.stringify({ role, username: 'Test Advisor', ...(isAdviser === undefined ? {} : { isAdviser }) })).toString('base64') + '.test';
    const subjects = [
        { _id: 'math', name: 'Math', className: 'Grade 7', studentCount: 1 },
        { _id: 'science', name: 'Science', className: 'Grade 8', studentCount: 1 }
    ];
    const advisory = {
        class: { name: 'Grade 7' },
        students: [{ lastName: '<img src=x onerror=alert(1)>', firstName: 'Ana', middleInitial: 'B', gender: 'Female' }],
        subjects: [{ name: 'English', teacher: { username: 'Another Teacher', email: 'teacher@example.test' } }]
    };
    const server = http.createServer((req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/dashboard.html') teacherDashboardVisits++;
        const json = (value, status = 200) => {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(value));
        };
        if (url.pathname === '/js/config.js') {
            res.setHeader('Content-Type', 'text/javascript');
            return res.end("const API_BASE_URL = '/api';");
        }
        if (url.pathname.startsWith('/api/')) {
            const route = url.pathname.slice(4);
            if (mode === 'academic-workflow' && academicFixture(req, url, json)) return;
            if (route === '/admin/teachers' && mode === 'admin-teachers-error') return json({ error: 'Teacher lookup failed' }, 500);
            if (route === '/admin/subjects' && mode === 'admin-subjects-error') return json({ error: 'Subject lookup failed' }, 500);
            if (route === '/admin/subjects' && mode === 'admin-subjects-delayed') {
                releaseSubjectResponse = () => json(subjects.map(subject => ({ ...subject, teacher: { _id: 'teacher1' }, class: { name: subject.className } })));
                return;
            }
            if (route === '/admin/teachers/teacher1/roles' && req.method === 'PUT') {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', () => {
                    roleSaveCount++;
                    if (failRoleSave) return json({ error: 'Could not save assignments.' }, 500);
                    savedRoles = JSON.parse(body);
                    return json({ message: 'Roles and assignments saved successfully.' });
                });
                return;
            }
            if (route === '/admin/teachers') return json([
                { _id: 'teacher1', username: 'Test Advisor', email: 'teacher@example.test', isActive: true,
                    advisoryClassId: savedRoles.advisoryClassId, advisoryClass: savedRoles.advisoryClassId ? 'Grade 7' : null,
                    subjectIds: savedRoles.subjectIds, subjectsTaught: savedRoles.subjectIds.map(id => subjects.find(s => s._id === id).name), teacherRoles: savedRoles.roles }
            ]);
            if (route === '/admin/classes') return json([
                { _id: 'class1', name: 'Grade 7', adviser: savedRoles.advisoryClassId ? { _id: 'teacher1', username: 'Test Advisor' } : null },
                { _id: 'class2', name: 'Grade 8', adviser: { _id: 'other', username: 'Other Teacher' } }
            ]);
            if (route === '/admin/subjects') return json(subjects.map(subject => ({
                ...subject, class: { _id: 'class1', name: subject.className },
                teacher: savedRoles.subjectIds.includes(subject._id) ? { _id: 'teacher1', username: 'Test Advisor' } : null
            })));
            if (route === '/login') {
                if (mode === 'invalid-login') return json({ error: 'Invalid email or password.' }, 400);
                if (mode === 'offline-login') return req.socket.destroy();
                return json({ token: tokenFor(mode === 'admin' ? 'admin' : 'teacher', mode !== 'teacher' && mode !== 'admin') });
            }
            if (route === '/adviser/my-class') {
                if (mode === 'assigned-account' && !savedRoles.advisoryClassId) return json({ error: 'No advisory' }, 404);
                if (mode === 'teacher') return json({ error: 'No advisory' }, 404);
                if (mode === 'homeroom-error') return json({ error: 'Homeroom unavailable' }, 500);
                if (mode === 'homeroom-offline') return req.socket.destroy();
                if (mode === 'expired') return json({ error: 'Expired token' }, 401);
                return json(mode === 'empty' ? { ...advisory, students: [], subjects: [] } : advisory);
            }
            if (route === '/teacher/my-subjects') {
                if (mode === 'assigned-account') return json(subjects.filter(subject => savedRoles.subjectIds.includes(subject._id)));
                if (mode === 'subjects-error') return json({ error: 'Assignments unavailable' }, 500);
                return json(['no-teaching', 'empty'].includes(mode) ? [] : subjects);
            }
            if (route.endsWith('/roster')) {
                if (mode === 'roster-error') return json({ error: 'Roster unavailable' }, 500);
                return json({ subjectName: route.includes('science') ? 'Science' : 'Math', totalStudents: 1, classAverage: 85, passingRate: 100,
                    roster: [{ studentId: 'student1', lastName: 'Santos', firstName: 'Ana', scores: { hw1: 85, quiz1: 85, midterm: 85, project1: 85 }, weightedGrade: 85 }] });
            }
            if (route === '/me') return json({ username: 'Test Advisor', photo: null });
            return json([]);
        }
        const file = path.resolve(root, '.' + url.pathname);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
        res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[path.extname(file)] || 'text/plain');
        fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = 'http://127.0.0.1:' + server.address().port;
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hope-advisor-test-'));
    const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let ws;
    t.after(async () => {
        if (ws) ws.close();
        child.kill();
        server.closeAllConnections();
        server.close();
        // Chrome may still hold profile files on Windows; cleanup is best effort.
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(profile).startsWith('hope-advisor-test-'));
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    });
    const endpoint = await new Promise((resolve, reject) => {
        let output = '';
        const timeout = setTimeout(() => reject(new Error('Chrome did not start: ' + output)), 15000);
        child.on('error', reject);
        child.stderr.on('data', (chunk) => {
            output += chunk;
            const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
            if (match) { clearTimeout(timeout); resolve(match[1]); }
        });
    });
    ws = new WebSocket(endpoint);
    await once(ws, 'open');
    let sequence = 0;
    const pending = new Map();
    const exceptions = [];
    ws.addEventListener('message', ({ data }) => {
        const message = JSON.parse(data);
        if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
        if (pending.has(message.id)) {
            const { resolve, reject, timeout } = pending.get(message.id);
            clearTimeout(timeout);
            pending.delete(message.id);
            if (message.error) reject(new Error(message.error.message));
            else resolve(message.result);
        }
    });
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
        const id = ++sequence;
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Chrome command timed out: ' + method)); }, 10000);
        pending.set(id, { resolve, reject, timeout });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const command = (method, params) => send(method, params, sessionId);
    await command('Page.enable');
    await command('Runtime.enable');
    await command('Network.enable');
    await command('Network.setBlockedURLs', { urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*', 'https://cdn.jsdelivr.net/*'] });
    const evaluate = async (expression) => {
        const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
        return result.result.value;
    };
    const waitFor = async (expression) => {
        for (let attempt = 0; attempt < 100; attempt++) {
            if (await evaluate(expression)) return;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error('Timed out: ' + expression);
    };
    let visit = 0;
    const navigate = async (page) => {
        const target = new URL(base + '/' + page);
        target.searchParams.set('testVisit', ++visit);
        await command('Page.navigate', { url: target.href });
        await waitFor('location.href === ' + JSON.stringify(target.href) + ' && document.readyState === "complete"');
    };
    await navigate('index.html');
    await evaluate('sessionStorage.setItem("token", ' + JSON.stringify(tokenFor('teacher')) + ')');

    await t.test('homeroom-only advisor starts on Dashboard and Class is inaccessible', async () => {
        mode = 'no-teaching';
        await navigate('class-advisor.html');
        await waitFor('document.getElementById("page-status").hidden');
        assert.equal(await evaluate('document.querySelector(".advisor-panel:not([hidden])").id'), 'view-dashboard');
        assert.equal(await evaluate('getComputedStyle(document.getElementById("class-nav")).display'), 'none');
        await evaluate('location.hash = "class"');
        await waitFor('location.hash === "#dashboard"');
        await evaluate('location.hash = "homeroom"');
        await waitFor('!document.getElementById("view-homeroom").hidden');
        assert.equal(await evaluate('document.querySelectorAll("#homeroom-tbody img").length'), 0);
        assert.match(await evaluate('document.getElementById("homeroom-tbody").textContent'), /<img/);
    });
    await t.test('subject assignment reveals Class, loads grades, and keeps selected subject in teacher tools', async () => {
        mode = 'advisor';
        await navigate('class-advisor.html#class');
        await waitFor('!document.getElementById("overview-content").hidden');
        assert.equal(await evaluate('document.getElementById("class-nav").hidden'), false);
        assert.equal(await evaluate('document.getElementById("stat-average").textContent'), '85%');
        await evaluate('document.getElementById("subject-select").value = "science"; document.getElementById("subject-select").dispatchEvent(new Event("change"))');
        await waitFor('document.getElementById("stat-average-note").textContent === "Science"');
        await evaluate('document.getElementById("grade-entry-link").click()');
        await waitFor('document.querySelector(".user-role")?.textContent === "Class Advisor"');
        assert.equal(await evaluate('document.getElementById("subject-select").value'), 'science');
        assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".sidebar-nav span"), n => n.textContent)'), ['Dashboard', 'Homeroom', 'Class', 'Grade Edit Request', 'Final Grade Reports']);
    });
    await t.test('failed assignment lookup keeps Class hidden and retry recovers', async () => {
        mode = 'subjects-error';
        await navigate('class-advisor.html');
        await waitFor('!document.getElementById("retry-btn").hidden');
        assert.equal(await evaluate('document.getElementById("class-nav").hidden'), true);
        assert.equal(await evaluate('document.getElementById("stat-homeroom").textContent'), 'Grade 7');
        mode = 'advisor';
        await evaluate('document.getElementById("retry-btn").click()');
        await waitFor('!document.getElementById("class-nav").hidden');
    });
    await t.test('roster errors recover through retry', async () => {
        mode = 'roster-error';
        await navigate('class-advisor.html#class');
        await waitFor('!document.getElementById("retry-roster-btn").hidden');
        mode = 'advisor';
        await evaluate('document.getElementById("retry-roster-btn").click()');
        await waitFor('!document.getElementById("overview-content").hidden');
    });
    await t.test('empty homeroom renders empty states and mobile menu opens and closes', async () => {
        mode = 'empty';
        await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        await navigate('class-advisor.html#homeroom');
        await waitFor('document.getElementById("page-status").hidden');
        assert.match(await evaluate('document.getElementById("homeroom-tbody").textContent'), /No students/);
        await evaluate('document.getElementById("sidebar-toggle").click()');
        assert.equal(await evaluate('document.body.classList.contains("sidebar-open")'), true);
        await evaluate('document.getElementById("sidebar-toggle").click()');
        assert.equal(await evaluate('document.body.classList.contains("sidebar-open")'), false);
        assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    });
    await t.test('login sends advisors and subject-only teachers to their respective dashboards', async () => {
        for (const [scenario, destination] of [['advisor', 'class-advisor.html'], ['teacher', 'dashboard.html']]) {
            mode = scenario;
            const priorVisits = teacherDashboardVisits;
            await navigate('index.html');
            await evaluate('document.getElementById("email").value = "teacher@example.test"; document.getElementById("password").value = "Password123"; document.getElementById("login-form").requestSubmit()');
            await waitFor('location.pathname.endsWith(' + JSON.stringify(destination) + ')');
            await waitFor(scenario === 'advisor' ? 'document.getElementById("page-status")?.hidden' : 'document.getElementById("stat-average")?.textContent === "85%"');
            if (scenario === 'advisor') assert.equal(teacherDashboardVisits, priorVisits, 'Adviser login never visits the subject-teacher dashboard');
        }
    });
    await t.test('profile preserves advisor menu without Class when unassigned', async () => {
        mode = 'no-teaching';
        await navigate('profile.html');
        await waitFor('document.querySelector(".user-role").textContent === "Class Advisor"');
        assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".sidebar-nav span"), n => n.textContent)'), ['Dashboard', 'Homeroom', 'Grade Edit Request', 'Final Grade Reports']);
    });
    await t.test('successful login survives failed and disconnected homeroom requests', async () => {
        for (const scenario of ['homeroom-error', 'homeroom-offline']) {
            mode = scenario;
            await navigate('index.html');
            await evaluate('clearToken(); document.getElementById("email").value = "teacher@example.test"; document.getElementById("password").value = "Password123"; document.getElementById("login-form").requestSubmit()');
            await waitFor('location.pathname.endsWith("class-advisor.html") && !document.getElementById("retry-btn")?.hidden');
            assert.ok(await evaluate('sessionStorage.getItem("token")'));
            assert.match(await evaluate('document.getElementById("page-status").textContent'), /Could not load homeroom/);
            assert.equal(await evaluate('document.querySelector(".user-role").textContent'), 'Class Advisor');
            await navigate('profile.html');
            await waitFor('document.querySelector(".user-role").textContent === "Class Advisor"');
            assert.equal(await evaluate('document.documentElement.classList.contains("workspace-pending")'), false);
        }
    });
    await t.test('invalid credentials and unreachable login keep the form usable with distinct errors', async () => {
        for (const [scenario, expected] of [['invalid-login', /Invalid email or password/], ['offline-login', /Cannot reach the sign-in server/]]) {
            mode = scenario;
            await navigate('index.html');
            await evaluate('clearToken(); document.getElementById("email").value = "teacher@example.test"; document.getElementById("password").value = "Password123"; document.getElementById("login-form").requestSubmit()');
            await waitFor('!document.getElementById("form-banner").hidden && !document.getElementById("submit-btn").disabled');
            assert.match(await evaluate('document.getElementById("form-banner").textContent'), expected);
            assert.equal(await evaluate('getToken()'), null);
            assert.equal(await evaluate('location.pathname'), '/index.html');
        }
    });
    await t.test('expired session returns to sign in and clears stored token', async () => {
        mode = 'expired';
        await evaluate('sessionStorage.setItem("token", ' + JSON.stringify(tokenFor('teacher')) + ')');
        await command('Page.navigate', { url: base + '/class-advisor.html' });
        await waitFor('location.pathname.endsWith("index.html")');
        assert.equal(await evaluate('sessionStorage.getItem("token")'), null);
    });
    await t.test('admin can assign both roles, edit existing roles, and recover from save errors', async () => {
        mode = 'admin';
        subjects.push(
            { _id: 'math-extra', name: 'Math', className: 'Grade 9 — Ruby', studentCount: 1 },
            { _id: 'english', name: 'English', className: 'Grade 10 — Diamond', studentCount: 1 }
        );
        await evaluate('sessionStorage.setItem("token", ' + JSON.stringify(tokenFor('admin')) + ')');
        await navigate('admin-dashboard.html');
        assert.equal(await evaluate('document.getElementById("open-add-teacher").parentElement.contains(document.getElementById("open-assign-roles"))'), true);
        await evaluate('document.getElementById("open-assign-roles").click()');
        await waitFor('!document.getElementById("roles-fields").disabled');
        assert.equal(await evaluate('document.querySelector("#roles-homeroom option[value=class2]").disabled'), true);
        await evaluate('document.getElementById("role-advisor").click(); document.getElementById("roles-homeroom").value = "class1"; document.getElementById("role-subject-teacher").click(); document.getElementById("form-assign-roles").requestSubmit()');
        assert.match(await evaluate('document.getElementById("roles-status").textContent'), /Select at least one/);
        assert.equal(roleSaveCount, 0);
        failRoleSave = true;
        await evaluate('document.querySelector("#roles-subjects input[value=math]").click(); document.getElementById("form-assign-roles").requestSubmit()');
        await waitFor('document.getElementById("roles-status").textContent.includes("Could not save roles")');
        assert.equal(await evaluate('document.getElementById("save-roles").disabled'), false);
        assert.equal(await evaluate('document.getElementById("role-advisor").checked'), true);
        failRoleSave = false;
        await evaluate('document.getElementById("form-assign-roles").requestSubmit()');
        await waitFor('document.getElementById("modal-assign-roles").classList.contains("hidden")');
        assert.deepEqual(savedRoles, { roles: ['class-advisor', 'subject-teacher'], advisoryClassId: 'class1', subjectIds: ['math'] });
        await waitFor('document.querySelectorAll("#teachers-tbody .teacher-role-badge").length === 2');
        assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("#teachers-tbody .teacher-role-badge"), item => item.textContent)'), ['Class Adviser', 'Subject Teacher']);
        assert.equal(await evaluate('document.querySelector("#teachers-tbody .assignment-class").textContent'), 'Grade 7');
        assert.equal(await evaluate('document.querySelector("#teachers-tbody .assignment-toggle")'), null);
        // Several subjects, including the same subject in distinct sections.
        await evaluate('document.getElementById("open-assign-roles").click()');
        await waitFor('!document.getElementById("roles-fields").disabled');
        await evaluate('document.querySelectorAll("#roles-subjects input:not(:checked)").forEach(input => input.click()); document.getElementById("form-assign-roles").requestSubmit()');
        await waitFor('document.querySelector("#teachers-tbody .assignment-count")?.textContent === "4 assignments"');
        assert.equal(await evaluate('document.querySelectorAll("#teachers-tbody .teaching-assignment-list li:not([hidden])").length'), 2);
        assert.equal(await evaluate('document.querySelector("#teachers-tbody .assignment-toggle").textContent'), '+2 more');
        await evaluate('document.querySelector("#teachers-tbody .assignment-toggle").click()');
        assert.equal(await evaluate('document.querySelectorAll("#teachers-tbody .teaching-assignment-list li:not([hidden])").length'), 4);
        assert.equal(await evaluate('document.querySelector("#teachers-tbody .assignment-toggle").getAttribute("aria-expanded")'), 'true');
        assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("#teachers-tbody .assignment-class"), item => item.textContent)'), ['Grade 10 — Diamond', 'Grade 7', 'Grade 9 — Ruby', 'Grade 8']);
        assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
        await evaluate('document.querySelector("#teachers-tbody .assignment-toggle").click()');
        assert.equal(await evaluate('document.querySelectorAll("#teachers-tbody .teaching-assignment-list li:not([hidden])").length'), 2);
        // Check the advisor page against the assignments saved through the modal.
        mode = 'assigned-account';
        await evaluate('sessionStorage.setItem("token", ' + JSON.stringify(tokenFor('teacher')) + ')');
        await navigate('class-advisor.html');
        await waitFor('document.getElementById("page-status").hidden');
        assert.equal(await evaluate('document.getElementById("class-nav").hidden'), false);
        mode = 'admin';
        await evaluate('sessionStorage.setItem("token", ' + JSON.stringify(tokenFor('admin')) + ')');
        await navigate('admin-dashboard.html');
        await evaluate('document.getElementById("open-assign-roles").click()');
        await waitFor('!document.getElementById("roles-fields").disabled');
        assert.equal(await evaluate('document.getElementById("role-advisor").checked && document.getElementById("role-subject-teacher").checked'), true);
        assert.equal(await evaluate('document.querySelector("#roles-subjects input[value=math]").checked'), true);
        await evaluate('document.getElementById("role-subject-teacher").click(); document.getElementById("form-assign-roles").requestSubmit()');
        await waitFor('document.getElementById("modal-assign-roles").classList.contains("hidden")');
        assert.deepEqual(savedRoles, { roles: ['class-advisor'], advisoryClassId: 'class1', subjectIds: [] });
        mode = 'assigned-account';
        await evaluate('sessionStorage.setItem("token", ' + JSON.stringify(tokenFor('teacher')) + ')');
        await navigate('class-advisor.html');
        await waitFor('document.getElementById("page-status").hidden');
        assert.equal(await evaluate('document.getElementById("class-nav").hidden'), true);
        assert.equal(await evaluate('document.querySelector("[data-view=homeroom]").hidden'), false);
    });
    await t.test('teacher accounts render despite failed or delayed subject details and retry recovers', async () => {
        await evaluate('sessionStorage.setItem("token", ' + JSON.stringify(tokenFor('admin')) + ')');
        savedRoles = { roles: ['subject-teacher'], advisoryClassId: null, subjectIds: ['math'] };
        mode = 'admin-subjects-error';
        await navigate('admin-dashboard.html');
        await waitFor('document.querySelector("#teachers-tbody .teacher-name")?.textContent === "Test Advisor"');
        await waitFor('!document.getElementById("retry-teachers").hidden && !document.getElementById("retry-teachers").disabled');
        assert.equal(await evaluate('document.querySelector("#teachers-tbody .assignment-subject").textContent'), 'Math');
        assert.match(await evaluate('document.getElementById("teacher-status").textContent'), /assignment details/);
        mode = 'admin';
        await evaluate('document.getElementById("retry-teachers").click()');
        await waitFor('document.querySelector("#teachers-tbody .assignment-class").textContent === "Grade 7"');
        mode = 'admin-subjects-delayed';
        await navigate('admin-dashboard.html');
        await waitFor('document.querySelector("#teachers-tbody .teacher-name")?.textContent === "Test Advisor"');
        assert.equal(await evaluate('document.querySelector("#teachers-tbody .assignment-subject").textContent'), 'Math');
        releaseSubjectResponse();
        await waitFor('document.querySelector("#teachers-tbody .assignment-class").textContent !== "Class details not loaded"');
        mode = 'admin-teachers-error';
        await navigate('admin-dashboard.html');
        await waitFor('document.getElementById("teachers-tbody").textContent.includes("could not be loaded")');
        await waitFor('!document.getElementById("retry-teachers").disabled');
        assert.doesNotMatch(await evaluate('document.getElementById("teachers-tbody").textContent'), /No teachers yet/);
        mode = 'admin';
        await evaluate('document.getElementById("retry-teachers").click()');
        await waitFor('document.querySelector("#teachers-tbody .teacher-name")?.textContent === "Test Advisor"');
    });
    await t.test('adviser registry, teacher finalization, reopening approval, and printable reports', async () => {
        mode = 'academic-workflow';
        await evaluate('sessionStorage.setItem("token", ' + JSON.stringify(tokenFor('teacher')) + ')');
        await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
        await navigate('class-advisor.html');
        await waitFor('document.getElementById("assigned-subjects-tbody").textContent.includes("Math")');
        assert.equal(await evaluate('document.getElementById("view-dashboard").hidden'), false);
        assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".sidebar-nav span"), n => n.textContent)'), ['Dashboard', 'Homeroom', 'Class', 'Grade Edit Request', 'Final Grade Reports']);
        await evaluate('document.querySelector("[data-view=homeroom]").click()');
        await waitFor('!document.getElementById("view-homeroom").hidden');
        await evaluate('document.querySelector("[data-adviser-tab=registry]").click()');
        await waitFor('document.getElementById("registry-tbody").textContent.includes("No students")');
        await evaluate('document.getElementById("register-student").click()');
        await waitFor('document.getElementById("student-dialog").open');
        await evaluate('document.getElementById("student-lrn").value="000000000001"; document.getElementById("student-first-name").value="Ana"; document.getElementById("student-last-name").value="Santos"; document.getElementById("student-middle-name").value="Reyes"; document.getElementById("student-gender").value="Female"; document.getElementById("student-class").value="class1"; document.getElementById("student-class").dispatchEvent(new Event("change")); document.querySelector("#student-subjects input").click(); document.getElementById("student-form").requestSubmit()');
        await waitFor('!document.getElementById("student-dialog").open && document.getElementById("registry-tbody").textContent.includes("Santos")');
        assert.match(await evaluate('document.getElementById("registry-tbody").textContent'), /000000000001/);
        await navigate('grade-entry.html?subject=math');
        await waitFor('document.querySelectorAll(".grade-input").length === 4 && !document.getElementById("save-btn").disabled');
        assert.equal(await evaluate('document.getElementById("finalize-btn").disabled'), true);
        await evaluate('document.querySelectorAll(".grade-input").forEach(input => { input.value="85"; input.dispatchEvent(new Event("input")); }); document.getElementById("save-btn").click()');
        await waitFor('document.getElementById("grade-status").textContent === "Grades saved."');
        await evaluate('document.getElementById("finalize-btn").click(); document.getElementById("grade-action-form").requestSubmit()');
        await waitFor('document.getElementById("grade-state").textContent.includes("Locked")');
        assert.equal(await evaluate('Array.from(document.querySelectorAll(".grade-input")).every(input => input.disabled)'), true);
        assert.equal(await evaluate('document.getElementById("save-btn").disabled'), true);
        await evaluate('document.getElementById("subject-summary-btn").click()');
        await waitFor('document.getElementById("report-dialog")?.open');
        assert.match(await evaluate('document.getElementById("report-dialog").textContent'), /Subject Grade Summary/);
        await evaluate('document.getElementById("report-dialog").close(); document.getElementById("request-edit-btn").click(); document.getElementById("grade-reason").value="Correct HW 1 to 90"; document.getElementById("grade-action-form").requestSubmit()');
        await waitFor('document.getElementById("grade-request-history").textContent.includes("pending")');
        assert.equal(await evaluate('document.getElementById("request-edit-btn").disabled'), true);
        await navigate('class-advisor.html#homeroom');
        await evaluate('document.querySelector("[data-view=requests]").click()');
        await waitFor('document.querySelector("#edit-requests-tbody button") !== null');
        await evaluate('document.querySelector("#edit-requests-tbody button").click(); document.getElementById("review-note").value="Verified"; document.getElementById("review-form").requestSubmit()');
        await waitFor('!document.getElementById("review-dialog").open && document.getElementById("edit-requests-tbody").textContent.includes("No pending")');
        await evaluate('document.querySelector("[data-adviser-tab=my-requests]").click()');
        await waitFor('document.getElementById("my-requests-tbody").textContent.includes("Approved")');
        await evaluate('document.querySelector("[data-adviser-tab=history]").click()');
        await waitFor('document.getElementById("history-tbody").textContent.includes("Reopening approved")');
        await evaluate('document.querySelector("[data-view=reports]").click()');
        await waitFor('document.querySelector("#monitor-students button") !== null');
        assert.equal(await evaluate('document.querySelector("#monitor-students button").disabled'), true);
        await navigate('grade-entry.html?subject=math');
        await waitFor('document.querySelector(".grade-input") && !document.querySelector(".grade-input").disabled');
        await evaluate('const input = document.querySelector(".grade-input"); input.value="90"; input.dispatchEvent(new Event("input")); document.getElementById("save-btn").click()');
        await waitFor('document.getElementById("grade-status").textContent === "Grades saved."');
        await evaluate('document.getElementById("finalize-btn").click(); document.getElementById("grade-action-form").requestSubmit()');
        await waitFor('document.getElementById("grade-state").textContent.includes("Locked")');
        await navigate('class-advisor.html#homeroom');
        await evaluate('document.querySelector("[data-view=reports]").click()');
        await waitFor('document.querySelector("#monitor-students button") && !document.querySelector("#monitor-students button").disabled');
        await evaluate('document.querySelector("#monitor-students button").click()');
        await waitFor('document.getElementById("report-dialog")?.open');
        assert.match(await evaluate('document.getElementById("report-dialog").textContent'), /Final Grade Report/);
        assert.match(await evaluate('document.getElementById("report-dialog").textContent'), /85.9%/);
        const printed = await command('Page.printToPDF', { printBackground: true });
        assert.ok(printed.data.length > 1000, 'Final report generates a printable PDF');
        await evaluate('document.getElementById("report-dialog").close()');
    });
    assert.deepEqual(exceptions, [], 'No uncaught browser exceptions');
});
