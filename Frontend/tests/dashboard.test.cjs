const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = (name) => fs.readFileSync(path.join(__dirname, '../js', name), 'utf8');
const flush = () => new Promise((resolve) => setImmediate(resolve));

function dashboard(api, getAdvisorClass = async () => null) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      hidden: false,
      textContent: '',
      events: {},
      replaceChildren() { this.textContent = ''; },
      addEventListener(event, handler) { this.events[event] = handler; }
    });
    return elements.get(id);
  };
  let start;
  const state = { pending: true, teaching: null, redirected: null };
  const context = {
    document: {
      addEventListener(event, handler) { start = handler; },
      getElementById: element,
      querySelectorAll: () => []
    },
    window: { addEventListener() {} },
    location: { hash: '', pathname: '/dashboard.html', replace(url) { state.redirected = url; } },
    getToken: () => 'token',
    getPayload: () => ({ role: 'teacher', username: 'Teacher' }),
    getAdvisorClass,
    workspaceHint: () => ({ adviser: false }),
    rememberWorkspace() {},
    confirmLogout() {},
    renderTeacherNavigation(teaching) { state.pending = false; state.teaching = teaching; },
    ClassBrowser: { create: () => ({ setSubjects() {}, show() {} }) },
    AcademicUI: {
      api,
      status(id, message) { element(id).textContent = message; },
      empty(body, message) { body.textContent = message; }
    }
  };
  vm.runInNewContext(source('dashboard.js'), context);
  start();
  return { state, element, context };
}

test('dashboard renders inline loading from its initial HTML without the blocking workspace shell', () => {
  const html = fs.readFileSync(path.join(__dirname, '../dashboard.html'), 'utf8');
  assert.doesNotMatch(html, /<script[^>]+src="js\/workspace-shell\.js"/);
  assert.match(html, /<p id="teacher-status" class="workflow-status" role="status">Loading your assignments\.\.\.<\/p>/);
  assert.ok(html.indexOf('id="teacher-status"') < html.indexOf('<h1>Dashboard</h1>'));
});

test('dashboard remains visible while advisory and subject requests are pending', async () => {
  let resolveAdvisory, resolveSubjects;
  const advisory = new Promise((resolve) => { resolveAdvisory = resolve; });
  const subjects = new Promise((resolve) => { resolveSubjects = resolve; });
  const { state, element } = dashboard(() => subjects, () => advisory);
  assert.equal(state.pending, false);
  assert.equal(element('view-dashboard').hidden, false);
  assert.equal(element('teacher-status').textContent, 'Loading your assignments...');
  assert.equal(element('retry-teacher').hidden, true);
  resolveAdvisory(null);
  await flush();
  assert.equal(state.pending, false);
  assert.equal(element('teacher-status').textContent, 'Loading your assignments...');
  resolveSubjects([]);
  await flush();
  assert.match(element('assigned-subjects-tbody').textContent, /not currently assigned/);
  assert.equal(element('teacher-status').textContent, '');
});

test('unassigned teacher sees the dashboard and empty assignments instead of the loading screen', async () => {
  const { state, element } = dashboard(async () => []);
  await flush();
  assert.equal(state.pending, false);
  assert.equal(state.teaching, false);
  assert.equal(element('view-dashboard').hidden, false);
  assert.match(element('assigned-subjects-tbody').textContent, /not currently assigned/);
  assert.equal(element('teacher-status').textContent, '');
});

test('assignment failure reveals a retryable dashboard and retry loads the empty state', async () => {
  let fails = true;
  const { state, element } = dashboard(async () => {
    if (fails) throw new Error('Connection failed');
    return [];
  });
  await flush();
  assert.equal(state.pending, false);
  assert.match(element('teacher-status').textContent, /Connection failed/);
  assert.equal(element('retry-teacher').hidden, false);
  assert.equal(element('assigned-subjects-tbody').textContent, '');
  fails = false;
  await element('retry-teacher').events.click();
  assert.match(element('assigned-subjects-tbody').textContent, /not currently assigned/);
  assert.equal(element('retry-teacher').hidden, true);
});

test('advisory lookup times out and cleans up its timer', async () => {
  let expire;
  let cleared = false;
  const context = vm.createContext({
    AbortController,
    API_BASE_URL: '/api',
    setTimeout(callback, delay) { assert.equal(delay, 20000); expire = callback; return 1; },
    clearTimeout(id) { assert.equal(id, 1); cleared = true; },
    fetch: (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })));
    })
  });
  vm.runInContext(source('auth.js'), context);
  const request = context.fetchTeacherData('token', '/adviser/my-class', true);
  expire();
  await assert.rejects(request, /server took too long/);
  assert.equal(cleared, true);
});

test('no advisory assignment remains a valid result and clears the timer', async () => {
  let cleared = false;
  const context = vm.createContext({
    AbortController,
    API_BASE_URL: '/api',
    setTimeout: () => 1,
    clearTimeout() { cleared = true; },
    fetch: async () => ({ status: 404 })
  });
  vm.runInContext(source('auth.js'), context);
  assert.equal(await context.fetchTeacherData('token', '/adviser/my-class', true), null);
  assert.equal(cleared, true);
});
