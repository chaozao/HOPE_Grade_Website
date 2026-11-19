document.addEventListener('DOMContentLoaded', () => {
  const actor = getPayload(getToken() || '');
  if (!actor) return;
  const admin = actor.role === 'admin';
  const host = document.querySelector(admin ? '#tab-subjects .teacher-actions' : '#view-requests .content-header');
  if (!host) return;
  const node = (tag, text) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element; };
  const button = (label, callback) => { const element = node('button', label); element.type = 'button'; element.className = 'filter-btn'; element.addEventListener('click', callback); return element; };
  async function api(path = '', options = {}) {
    const response = await fetch(API_BASE_URL + '/subject-leadership' + path, { ...options, headers: { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'application/json' } });
    let data;
    try { data = await response.json(); }
    catch { throw new Error('Grading settings are unavailable. Restart the updated backend and try again.'); }
    if (!response.ok) throw new Error(data.error || 'Request failed.'); return data;
  }
  const dialog = node('dialog'); dialog.className = 'leadership-dialog';
  dialog.setAttribute('aria-label', admin ? 'Assign subject heads' : 'Subject head grading controls');
  document.body.appendChild(dialog);
  let busy = false;
  dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
  dialog.addEventListener('click', (event) => {
    const rect = dialog.getBoundingClientRect();
    if (!busy && event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
  async function render() {
    dialog.replaceChildren(node('h2', admin ? 'Subject heads' : 'Subject head controls'));
    const message = node('p', 'Loading...'); message.setAttribute('role', 'status'); dialog.appendChild(message);
    const assignments = [];
    let saveAll;
    const refreshSave = () => { if (saveAll) saveAll.disabled = busy || !assignments.some((item) => item.input.value !== item.saved); };
    try {
      const data = await api();
      message.textContent = admin ? 'A subject head manages deadlines and edit requests for every section with this subject name.' : 'Set a grading deadline. After it passes, other teachers need your approval. Your own assigned grades stay editable.';
      for (const subject of data.subjects) {
        const form = node(admin ? 'section' : 'form'); form.className = 'leadership-row';
        form.appendChild(node('h3', subject.label));
        const label = node('label', admin ? 'Subject head' : 'Deadline (your local time)');
        const input = node(admin ? 'select' : 'input'); input.setAttribute('aria-label', subject.label + (admin ? ' subject head' : ' deadline'));
        if (admin) {
          input.appendChild(new Option('No subject head', ''));
          data.teachers.forEach((teacher) => input.appendChild(new Option(teacher.username, teacher._id)));
          input.value = subject.head || '';
        } else {
          input.type = 'datetime-local';
          if (subject.deadline) {
            const date = new Date(subject.deadline);
            input.value = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
          }
        }
        label.appendChild(input); form.appendChild(label);
        if (admin) {
          assignments.push({ subject, input, saved: input.value });
          input.addEventListener('change', refreshSave);
          dialog.appendChild(form);
          continue;
        }
        const submit = node('button', 'Save'); submit.type = 'submit'; submit.className = 'filter-btn'; form.appendChild(submit);
        if (!admin) form.appendChild(node('p', 'Leave blank to remove the deadline. Changing it resets prior edit permissions.'));
        form.addEventListener('submit', async (event) => {
          event.preventDefault(); if (busy) return;
          busy = true; submit.disabled = true;
          try {
            await api('', { method: 'PUT', body: JSON.stringify({ name: subject.name, ...(admin ? { head: input.value || null } : { deadline: input.value ? new Date(input.value).toISOString() : null }) }) });
            message.textContent = 'Saved. Refresh an open gradebook to see the latest access.';
          } catch (error) { message.textContent = error.message; }
          finally { busy = false; submit.disabled = false; }
        });
        dialog.appendChild(form);
      }
      if (!data.subjects.length) dialog.appendChild(node('p', admin ? 'Create subjects first.' : 'You are not assigned as a subject head. Ask Super Admin to assign you through Subjects > Subject heads. You can save and finalize your assigned grades in Class; no subject-head assignment is needed.'));
      if (!admin && data.subjects.length) {
        dialog.appendChild(node('h3', 'Grade edit requests'));
        const requests = (await api('/requests')).filter((item) => item.status === 'pending');
        if (!requests.length) dialog.appendChild(node('p', 'No pending requests.'));
        requests.forEach((request) => {
          const row = node('section'); row.className = 'leadership-row';
          row.append(node('h4', (request.subject?.name || 'Subject') + ' — ' + (request.class?.name || '')), node('p', (request.requestedBy?.username || 'Teacher') + ': ' + request.reason));
          const note = node('textarea'); note.placeholder = 'Review note (optional)'; note.maxLength = 1000; note.setAttribute('aria-label', 'Review note'); row.appendChild(note);
          for (const decision of ['approved', 'rejected']) row.appendChild(button(decision === 'approved' ? 'Approve editing' : 'Reject', async () => {
            if (busy) return; busy = true;
            try { await api('/requests/' + request._id + '/review', { method: 'POST', body: JSON.stringify({ decision, note: note.value }) }); busy = false; await render(); }
            catch (error) { message.textContent = error.message; }
            finally { busy = false; }
          }));
          dialog.appendChild(row);
        });
      }
    } catch (error) { message.textContent = error.message; dialog.appendChild(button('Retry', render)); }
    const footer = node('footer'); footer.className = 'leadership-footer';
    const close = button('Close', () => { if (!busy) dialog.close(); });
    footer.appendChild(close);
    if (admin && assignments.length) {
      saveAll = button('Save changes', async () => {
        if (busy || saveAll.disabled) return;
        busy = true; close.disabled = true; refreshSave();
        assignments.forEach((item) => { item.input.disabled = true; });
        saveAll.textContent = 'Saving...';
        let completed = 0;
        try {
          for (const item of assignments.filter((item) => item.input.value !== item.saved)) {
            await api('', { method: 'PUT', body: JSON.stringify({ name: item.subject.name, head: item.input.value || null }) });
            item.saved = item.input.value;
            completed++;
          }
          message.textContent = 'All subject-head changes saved.';
        } catch (error) {
          message.textContent = completed + ' change(s) saved. Remaining changes are kept; click Save changes to retry. ' + error.message;
        } finally {
          busy = false; close.disabled = false;
          assignments.forEach((item) => { item.input.disabled = false; });
          saveAll.textContent = 'Save changes'; refreshSave();
        }
      });
      saveAll.className = 'filter-btn leadership-save';
      footer.appendChild(saveAll); refreshSave();
    }
    dialog.appendChild(footer);
  }
  host.appendChild(button(admin ? 'Subject heads' : 'Subject head controls', () => { dialog.showModal(); render(); }));
});
