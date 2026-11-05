const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function api(response) {
  const context = { window: {}, API_BASE_URL: 'http://localhost:3000',
    getToken: () => 'test', AbortController, setTimeout, clearTimeout,
    fetch: async () => response };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/academic-ui.js'), 'utf8'), context);
  return context.window.AcademicUI.api;
}
test('missing reorder endpoint explains how to recover instead of parsing HTML', async () => {
  const request = api({ status: 404, ok: false, json: async () => { throw new SyntaxError('Unexpected token <'); } });
  await assert.rejects(request('/teacher/subjects/123/activity-order', { method: 'PUT' }),
    (error) => error.status === 404 && /Restart the Node server/.test(error.message) && /pending order/.test(error.message));
});
test('other HTML responses identify endpoint and status without showing raw HTML', async () => {
  const request = api({ status: 502, ok: false, json: async () => { throw new SyntaxError('Unexpected token <'); } });
  await assert.rejects(request('/teacher/my-subjects'), /GET \/teacher\/my-subjects \(HTTP 502\)/);
});
test('normal JSON success and validation responses are preserved', async () => {
  assert.deepEqual(await api({ status: 200, ok: true, json: async () => ({ gradeVersion: 2 }) })('/test'), { gradeVersion: 2 });
  await assert.rejects(api({ status: 409, ok: false, json: async () => ({ error: 'Reload this record.' }) })('/test'),
    (error) => error.status === 409 && error.message === 'Reload this record.');
});
