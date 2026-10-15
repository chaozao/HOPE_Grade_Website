const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
    constructor(tag, text = '') { this.tag = tag; this.text = text; this.children = []; this.events = {}; this.classList = { toggle() {} }; }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.append(node); return node; }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute() {}
    focus() {}
    getBoundingClientRect() { return { left: 100, right: 500, top: 100, bottom: 400 }; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    reportValidity() { return true; }
    addEventListener(type, handler) { this.events[type] = handler; }
    get textContent() { return this.text + this.children.map(node => node.textContent).join(''); }
    set textContent(value) { this.text = value; this.children = []; }
    get firstElementChild() { return this.children[0]; }
    get value() { return this.selection ?? this.children[0]?.value; }
    set value(value) { this.selection = value; }
    get selectedOptions() { return this.children.filter(node => node.value === this.value); }
}
const findAll = (root, check) => [root, ...root.children.flatMap(child => findAll(child, check))].filter(check);
const byId = (root, id) => findAll(root, node => node.id === id)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(api) {
    const context = { window: {}, Node: Element, document: { createElement: tag => new Element(tag) },
        Option: function (text, value) { const el = new Element('option', text); el.value = value; return el; } };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/academic-ui.js'), 'utf8'), context);
    context.AcademicUI = context.window.AcademicUI; context.AcademicUI.api = api;
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/class-browser.js'), 'utf8'), context);
    const root = new Element('div'), browser = context.window.ClassBrowser.create(root);
    browser.setSubjects([{ _id: 'science', name: 'Science', className: 'Grade 7', studentCount: 0 }]);
    return { root, browser };
}

test('enrollment totals refresh and term tables sort names without reusing legacy grades', async () => {
    const data = { totalStudents: 2, passingRate: 100, roster: [
        { lastName: 'Zulu', firstName: 'Ana', middleName: 'Lee', lrn: '002', weightedGrade: 99 },
        { lastName: 'alpha', firstName: 'Ben', lrn: '001', weightedGrade: 85 }
    ] };
    const { root, browser } = fixture(async () => data);
    await browser.show();
    assert.equal(byId(root, 'class-subjects-tbody').children[0].children[2].textContent, '2');
    findAll(root, node => node.tag === 'a')[0].events.click({ preventDefault() {} });
    await flush();
    let body = byId(root, 'class-grades-tbody');
    assert.equal(body.children[0].children[1].textContent, 'alpha, Ben');
    assert.equal(body.children[1].children[1].textContent, 'Zulu, Ana Lee');
    assert.equal(body.children[0].children.length, 8);
    assert.equal(body.children[0].children[6].textContent, '—');
    const select = byId(root, 'class-term-select');
    for (const value of ['2', '3', '4']) { select.value = value; select.events.change(); }
    body = byId(root, 'class-grades-tbody');
    assert.equal(body.children[0].children.length, 7);
    assert.equal(body.children[0].children[6].textContent, 'Incomplete');
    data.totalStudents = 3;
    await browser.show();
    assert.equal(byId(root, 'class-subjects-tbody').children[0].children[2].textContent, '3');
});

test('failed summaries offer retry and empty rosters show an enrollment message', async () => {
    let fail = true;
    const { root, browser } = fixture(async () => {
        if (fail) throw new Error('Offline');
        return { totalStudents: 0, passingRate: null, roster: [] };
    });
    await browser.show();
    assert.equal(byId(root, 'class-browser-retry').hidden, false);
    fail = false;
    await byId(root, 'class-browser-retry').events.click();
    assert.equal(byId(root, 'class-browser-status').hidden, true);
    findAll(root, node => node.tag === 'a')[0].events.click({ preventDefault() {} });
    await flush();
    assert.match(byId(root, 'class-grades-tbody').textContent, /No students enrolled/);
    assert.equal(byId(root, 'class-grades-tbody').firstElementChild.firstElementChild.colSpan, 8);
});

test('final grades average all three terms and require every grade, including valid zero scores', async () => {
    for (const [values, expected, remark] of [
        [[80, 85, 90], '85', 'Passed'],
        [[80, 80, 81], '80.3', 'Passed'],
        [[0, 75, 75], '50', 'Failed'],
        [[80, 90, null], '—', 'Incomplete'],
        [[80, 90, undefined], '—', 'Incomplete'],
        [[80, 90, '90'], '—', 'Incomplete'],
        [[80, 90, NaN], '—', 'Incomplete'],
        [[80, 90, 101], '—', 'Incomplete']
    ]) {
        const terms = Object.fromEntries(values.map((termGrade, index) => [index + 1, { termGrade }]));
        const { root, browser } = fixture(async () => ({ totalStudents: 1, passingRate: null,
            roster: [{ lastName: 'Santos', firstName: 'Ana', terms, finalGrade: 100 }] }));
        await browser.show();
        findAll(root, node => node.tag === 'a')[0].events.click({ preventDefault() {} });
        await flush();
        const select = byId(root, 'class-term-select'); select.value = '4'; select.events.change();
        const cells = byId(root, 'class-grades-tbody').firstElementChild.children;
        assert.equal(cells[4].textContent, expected);
        assert.equal(cells[6].textContent, remark);
    }
});

test('activities add numbered columns only to their category and term and survive reload', async () => {
    const data = { totalStudents: 1, gradeVersion: 0, gradeStatus: 'draft', activities: [], roster: [{ firstName: 'Ana', lastName: 'Santos' }] };
    const { root, browser } = fixture(async (url, options) => {
        if (options?.method === 'POST') {
            const input = JSON.parse(options.body);
            assert.equal(input.term, 1);
            assert.equal(input.category, 'writtenOral');
            assert.equal(input.maxScore, 5);
            data.activities.push({ ...input, _id: String(data.activities.length + 1) });
            return { activities: data.activities, gradeVersion: ++data.gradeVersion };
        }
        return data;
    });
    async function open() {
        await browser.show();
        findAll(root, node => node.tag === 'a')[0].events.click({ preventDefault() {} });
        await flush();
    }
    await open();
    for (let number = 1; number <= 6; number++) {
        findAll(root, node => node.tag === 'button' && node.textContent === '+ Add column')[0].events.click();
        const form = findAll(root, node => node.tag === 'form' && node.className === 'activity-editor')[0];
        const inputs = findAll(form, node => node.tag === 'input');
        inputs[0].value = 'Written Work ' + number; inputs[1].value = '5';
        await form.events.submit({ preventDefault() {} });
    }
    assert.equal(byId(root, 'class-grades-tbody').firstElementChild.children.length, 13);
    await open();
    assert.equal(byId(root, 'class-grades-tbody').firstElementChild.children.length, 13);
    assert.match(root.textContent, /Written Work 6/);
    const select = byId(root, 'class-term-select'); select.value = '2'; select.events.change();
    assert.equal(byId(root, 'class-grades-tbody').firstElementChild.children.length, 8);
    select.value = '4'; select.events.change();
    assert.equal(findAll(root, node => node.tag === 'button' && node.textContent === '+ Add column').length, 0);
    data.gradeStatus = 'finalized'; await open();
    assert.ok(findAll(root, node => node.tag === 'button' && node.textContent === '+ Add column').every(button => button.disabled));
});

test('edit modal populates fields, saves changes, and deletes the selected column', async () => {
    const activity = { _id: 'a1', term: 1, category: 'writtenOral', title: 'WS 1', maxScore: 5 };
    const data = { totalStudents: 0, activities: [activity], roster: [], gradeVersion: 0 };
    let method;
    const { root, browser } = fixture(async (url, options) => {
        if (options) {
            assert.ok(url.endsWith('/activities/a1'));
            method = options.method;
            const input = JSON.parse(options.body);
            if (method === 'PUT') { activity.title = input.title; activity.maxScore = input.maxScore; }
            if (method === 'DELETE') data.activities = [];
            return { activities: data.activities, gradeVersion: ++data.gradeVersion };
        }
        return data;
    });
    await browser.show();
    findAll(root, node => node.tag === 'a')[0].events.click({ preventDefault() {} }); await flush();
    const edit = () => {
        findAll(root, node => node.tag === 'button' && node.textContent === 'Manage columns')[0].events.click();
        findAll(root, node => node.tag === 'button' && node.className?.includes('activity-edit'))[0].events.click();
    };
    assert.equal(findAll(root, node => node.tag === 'button' && node.className?.includes('activity-edit')).length, 0, 'Table headers contain no edit buttons');
    edit();
    const dialog = findAll(root, node => node.tag === 'dialog')[0];
    assert.equal(dialog.open, true);
    dialog.events.pointerdown({ target: dialog, clientX: 120, clientY: 120 });
    dialog.events.click({ target: dialog, clientX: 120, clientY: 120 });
    assert.equal(dialog.open, true, 'Inside clicks keep the modal open');
    dialog.events.pointerdown({ target: dialog, clientX: 20, clientY: 20 });
    dialog.events.click({ target: dialog, clientX: 20, clientY: 20 });
    assert.equal(dialog.open, false, 'Backdrop clicks close the modal');
    edit();
    const form = findAll(dialog, node => node.tag === 'form' && node.className === 'activity-editor')[0];
    const inputs = findAll(form, node => node.tag === 'input');
    assert.equal(inputs[0].value, 'WS 1');
    inputs[0].value = 'Written Work 1'; inputs[1].value = '50';
    await form.events.submit({ preventDefault() {} });
    assert.equal(method, 'PUT'); assert.equal(dialog.open, false);
    assert.match(root.textContent, /Written Work 1/);
    edit();
    await findAll(dialog, node => node.tag === 'button' && node.textContent === 'Delete column')[0].events.click();
    assert.equal(method, 'DELETE'); assert.equal(dialog.open, false);
    assert.equal(findAll(root, node => node.tag === 'button' && node.className?.includes('activity-edit')).length, 0);
});

test('manager saves edited columns using the latest version and keeps toolbar controls ordered', async () => {
    const data = { gradeVersion: 2, totalStudents: 0, roster: [], activities: [
        { _id: 'a', term: 1, category: 'writtenOral', title: 'WS 1', maxScore: 5 },
        { _id: 'b', term: 1, category: 'examination', title: 'Exam', maxScore: 20 }
    ] };
    let saves = 0;
    const { root, browser } = fixture(async (url, options) => {
        if (options) {
            const input = JSON.parse(options.body);
            assert.equal(input.version, 2 + saves++);
            const activity = data.activities.find(item => url.endsWith('/' + item._id));
            activity.title = input.title; activity.maxScore = input.maxScore;
            return { activities: data.activities, gradeVersion: ++data.gradeVersion };
        }
        return data;
    });
    await browser.show();
    findAll(root, node => node.tag === 'a')[0].events.click({ preventDefault() {} }); await flush();
    const actions = findAll(root, node => node.className === 'class-toolbar-actions')[0];
    assert.equal(actions.children[0].textContent, 'Manage columns');
    assert.equal(actions.children[1].tag, 'label');
    actions.children[0].events.click();
    const manager = findAll(root, node => node.className === 'activity-manager')[0];
    const inputs = findAll(manager, node => node.tag === 'input');
    inputs[0].value = 'Written work revised'; inputs[3].value = '50';
    await manager.onsubmit({ preventDefault() {} });
    assert.equal(saves, 2);
    assert.equal(data.activities[0].title, 'Written work revised');
    assert.equal(data.activities[1].maxScore, 50);
    assert.equal(findAll(root, node => node.tag === 'dialog')[0].open, false);
});

test('score inputs block values over maximum, save valid scores and reload them', async () => {
    const data = { gradeVersion: 0, activities: [{ _id: 'a', term: 1, category: 'writtenOral', title: 'WS 1', maxScore: 50 }],
        totalStudents: 1, roster: [{ studentId: 's1', firstName: 'Ana', lastName: 'Santos', activityScores: {} }] };
    let saves = 0;
    const { root, browser } = fixture(async (url, options) => {
        if (options) {
            assert.ok(url.endsWith('/activity-scores'));
            const input = JSON.parse(options.body); assert.equal(input.grades[0].scores.a, 50);
            saves++; data.roster[0].activityScores.a = 50; return { gradeVersion: 1 };
        }
        return data;
    });
    const open = async () => {
        await browser.show(); findAll(root, node => node.tag === 'a')[0].events.click({ preventDefault() {} }); await flush();
    };
    await open();
    let input = findAll(root, node => node.className === 'activity-score-input')[0];
    const save = byId(root, 'save-activity-scores');
    assert.equal(input.value, '');
    input.value = '51'; input.events.input();
    assert.equal(save.disabled, true);
    assert.match(root.textContent, /Enter 0 to 50 points/);
    await save.events.click(); assert.equal(saves, 0);
    input.value = '50'; input.events.input(); assert.equal(save.disabled, false);
    await save.events.click(); assert.equal(saves, 1);
    await open(); input = findAll(root, node => node.className === 'activity-score-input')[0];
    assert.equal(input.value, '50');
});

test('activity creation requires both a nonblank name and maximum points', async () => {
    let writes = 0;
    const { root, browser } = fixture(async (url, options) => {
        if (options) { writes++; return { activities: [], gradeVersion: 1 }; }
        return { totalStudents: 0, activities: [], roster: [] };
    });
    await browser.show(); findAll(root, node => node.tag === 'a')[0].events.click({ preventDefault() {} }); await flush();
    findAll(root, node => node.textContent === '+ Add column' && node.tag === 'button')[0].events.click();
    const form = findAll(root, node => node.className === 'activity-editor')[0];
    const inputs = findAll(form, node => node.tag === 'input');
    for (const [name, max] of [['', '50'], ['   ', '50'], ['WS 1', ''], ['WS 1', '0']]) {
        inputs[0].value = name; inputs[1].value = max; await form.events.submit({ preventDefault() {} });
        assert.equal(writes, 0);
    }
    inputs[0].value = 'WS 1'; inputs[1].value = '50'; await form.events.submit({ preventDefault() {} });
    assert.equal(writes, 1);
});
