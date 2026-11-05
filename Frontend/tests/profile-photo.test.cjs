const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
class Element {
  constructor(tag) {
    this.tag = tag; this.children = []; this.events = {}; this.dataset = {}; this.style = {};
    this.clientWidth = 800; this.clientHeight = 600;
  }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); return child; }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, action) { this.events[name] = action; }
  querySelector(selector) {
    return all(this).find((element) => selector === 'img' ? element.tag === 'img' :
      selector === '[data-zoom="out"]' ? element.dataset.zoom === 'out' : element.dataset.zoom === 'in');
  }
  showModal() { this.open = true; }
  close() { this.open = false; }
  getBoundingClientRect() { return { top: 10, left: 10, bottom: 700, right: 900 }; }
}
const all = (root) => root.children.flatMap((child) => [child, ...all(child)]);
function fixture(role, previewEnabled = true) {
  const body = new Element('body'), sidebar = new Element('div'), preview = new Element('button');
  preview.id = 'avatar-preview';
  const remove = new Element('button'), input = new Element('input'), banner = new Element('p');
  const targets = previewEnabled ? [sidebar, preview] : [sidebar];
  body.append(...targets);
  let ready, fetches = 0;
  const context = { URL, API_BASE_URL: 'http://localhost:3000',
    getToken: () => 'token', getPayload: () => ({ role }),
    window: { addEventListener() {} },
    document: {
      body, createElement: (tag) => new Element(tag),
      querySelectorAll: () => targets, querySelector: () => sidebar,
      getElementById: (id) => previewEnabled ? ({ 'avatar-preview': preview, 'remove-profile-photo': remove, 'photo-input': input, 'form-banner': banner }[id] || null) : null,
      addEventListener(name, handler) { ready = handler; }
    },
    fetch: async (url, options) => { fetches++; return { ok: true, json: async () => options?.method === 'DELETE' ? {} : ({ photo: '/uploads/avatars/saved.jpg' }) }; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/profile-photo.js'), 'utf8'), context);
  return { api: context.window.ProfilePhoto, body, sidebar, preview, remove, banner, ready: () => ready(), fetches: () => fetches };
}
test('Remove photo restores the default icon for each role', async () => {
  for (const role of ['admin', 'teacher']) {
    const view = fixture(role);
    await view.ready();
    view.api.render('/uploads/avatars/photo.jpg');
    assert.equal(view.remove.hidden, false);
    await view.remove.events.click();
    const confirmation = all(view.body).find((element) => element.className === 'photo-delete-confirm');
    assert.equal(confirmation.open, true);
    assert.equal(view.fetches(), 0);
    await all(confirmation).find((element) => element.textContent === 'Yes').events.click();
    assert.equal(view.remove.hidden, true);
    assert.equal(view.sidebar.children[0].tag, 'i');
    assert.equal(view.preview.disabled, true);
    assert.match(view.banner.textContent, /default icon has been restored/);
  }
});
test('No and outside clicks close confirmation without deleting the photo', async () => {
  const view = fixture('teacher');
  await view.ready();
  view.api.render('/uploads/avatars/photo.jpg');
  view.remove.events.click();
  const dialog = all(view.body).find((element) => element.className === 'photo-delete-confirm');
  assert.equal(dialog.children[0].textContent, 'Are you sure you want to delete this picture');
  all(dialog).find((element) => element.textContent === 'No').events.click();
  assert.equal(dialog.open, false);
  assert.equal(view.fetches(), 0);
  view.remove.events.click();
  dialog.events.click({ target: dialog, clientX: 100, clientY: 100 });
  assert.equal(dialog.open, true);
  dialog.events.click({ target: dialog, clientX: 0, clientY: 0 });
  assert.equal(dialog.open, false);
  assert.equal(view.fetches(), 0);
  assert.equal(view.sidebar.children[0].tag, 'img');
});
test('saved and newly uploaded photos update sidebar and preview for admins and teachers', async () => {
  for (const role of ['admin', 'teacher']) {
    const view = fixture(role);
    await view.ready();
    assert.equal(view.fetches(), 0);
    view.api.render('/uploads/avatars/first.jpg');
    assert.equal(view.sidebar.children[0].src, 'http://localhost:3000/uploads/avatars/first.jpg');
    assert.equal(view.preview.disabled, false);
    view.api.render('/uploads/avatars/replacement.jpg');
    assert.equal(view.sidebar.children[0].src, view.preview.children[0].src);
    assert.match(view.sidebar.children[0].src, /replacement.jpg$/);
    view.api.render(null);
    assert.equal(view.preview.disabled, true);
    assert.equal(view.sidebar.children[0].tag, 'i');
  }
});
test('dashboard pages fetch the saved account photo after navigation', async () => {
  for (const role of ['admin', 'teacher']) {
    const view = fixture(role, false);
    await view.ready();
    assert.equal(view.fetches(), 1);
    assert.match(view.sidebar.children[0].src, /saved.jpg$/);
  }
});
test('profile viewer enlarges small uploads into a circle and supports zoom in and out', async () => {
  const view = fixture('teacher');
  await view.ready();
  view.api.render('/uploads/avatars/photo.jpg');
  view.preview.events.click();
  const dialog = all(view.body).find((element) => element.tag === 'dialog');
  assert.equal(dialog.open, true);
  const full = dialog.querySelector('img');
  full.naturalWidth = 150; full.naturalHeight = 200;
  full.events.load();
  const fit = parseFloat(full.style.width);
  assert.ok(fit > full.naturalWidth);
  assert.equal(full.style.width, full.style.height);
  const buttons = all(dialog).filter((element) => element.tag === 'button');
  buttons.find((element) => element.textContent === 'Zoom in').events.click();
  assert.equal(parseFloat(full.style.width), fit * 1.25);
  buttons.find((element) => element.textContent === 'Fit').events.click();
  assert.equal(parseFloat(full.style.width), fit);
  buttons.find((element) => element.textContent === 'Zoom out').events.click();
  assert.equal(parseFloat(full.style.width), fit * 0.75);
  assert.equal(full.style.width, full.style.height);
  buttons.find((element) => element.textContent === 'Close').events.click();
  assert.equal(dialog.open, false);
  view.preview.events.click();
  dialog.events.click({ target: dialog, clientX: 0, clientY: 0 });
  assert.equal(dialog.open, false);
});
test('broken photos fall back safely and every role page includes shared photo support', async () => {
  const view = fixture('admin');
  await view.ready();
  view.api.render('/uploads/avatars/missing.jpg');
  view.preview.children[0].events.error();
  assert.equal(view.preview.disabled, true);
  for (const name of ['dashboard', 'class-advisor', 'admin-dashboard', 'profile', 'grade-entry', 'student-insights']) {
    const html = fs.readFileSync(path.join(__dirname, '..', name + '.html'), 'utf8');
    assert.match(html, /src="js\/profile-photo.js"/);
    assert.match(html, /href="css\/profile-photo.css"/);
  }
});
