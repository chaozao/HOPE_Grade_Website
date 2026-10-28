document.addEventListener('DOMContentLoaded', function () {
  const trigger = document.getElementById('open-admin-history');
  const UI = AcademicUI;
  let dialog, tbody, status, retry, more, close, next, busy = false;
  function formatDate(value) {
    const date = new Date(value);
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila', month: '2-digit', day: '2-digit', year: '2-digit',
      hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true
    }).formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.month}/${parts.day}/${parts.year} - ${parts.hour}:${parts.minute}:${parts.second}${parts.dayPeriod}`;
  }
  function message(text, error = false) {
    status.textContent = text;
    status.classList.toggle('is-error', error);
  }
  function setBusy(value) {
    busy = value;
    dialog.querySelectorAll('button').forEach(button => { button.disabled = value; });
    dialog.setAttribute('aria-busy', String(value));
  }
  async function load(append = false) {
    setBusy(true);
    message('Loading history…');
    retry.hidden = true;
    if (!append) tbody.replaceChildren();
    try {
      const data = await UI.api('/admin/history' + (append && next ? '?before=' + encodeURIComponent(next) : ''));
      next = data.next;
      for (const entry of data.entries) {
        let action = entry.undoneAt ? UI.node('span', 'Undone', 'admin-history-note') : null;
        if (entry.undoneAt) action.title = 'Undone ' + formatDate(entry.undoneAt);
        if (entry.canUndo) {
          action = UI.button('Undo', async () => {
            if (busy) return;
            setBusy(true);
            message('Undoing change…');
            try {
              await UI.api('/admin/history/' + encodeURIComponent(entry._id) + '/undo', { method: 'POST' });
              document.dispatchEvent(new Event('admin-history-undone'));
              await load();
              if (!status.classList.contains('is-error')) message('Change undone.');
            } catch (error) {
              message(error.message, true);
            } finally { setBusy(false); }
          });
          action.className = 'admin-history-undo';
          action.setAttribute('aria-label', 'Undo: ' + entry.action);
        }
        const date = UI.node('div', undefined, 'admin-history-date');
        date.appendChild(UI.node('span', formatDate(entry.date)));
        if (action) date.appendChild(action);
        UI.row(tbody, [entry.name, entry.action, date]);
      }
      if (!tbody.children.length) UI.empty(tbody, 'No history yet. New changes will appear here.', 3);
      more.hidden = !next;
      message('');
    } catch (error) {
      message(error.message, true);
      retry.hidden = false;
      more.hidden = true;
      retry.onclick = () => load(append);
    } finally { setBusy(false); }
  }
  trigger.addEventListener('click', () => {
    if (!dialog) {
      dialog = UI.node('dialog', undefined, 'admin-history-dialog');
      dialog.id = 'admin-history-dialog';
      dialog.setAttribute('aria-labelledby', 'admin-history-title');
      dialog.innerHTML = '<div class="admin-history-heading"><div><h2 id="admin-history-title">History</h2><p>Changes across teachers, classes, and subjects. Times shown in Philippine time.</p></div><button type="button" class="admin-history-close" aria-label="Close history" title="Close"><span aria-hidden="true">&times;</span></button></div><p class="admin-history-status" role="status"></p><button type="button" class="admin-history-retry" hidden>Retry loading</button><div class="admin-history-table" tabindex="0" role="region" aria-label="Modification history"><table><thead><tr><th scope="col">Name</th><th scope="col">Action</th><th scope="col">Date / time</th></tr></thead><tbody></tbody></table></div><button type="button" class="admin-history-more" hidden>Load more</button>';
      document.body.appendChild(dialog);
      tbody = dialog.querySelector('tbody');
      status = dialog.querySelector('.admin-history-status');
      retry = dialog.querySelector('.admin-history-retry');
      more = dialog.querySelector('.admin-history-more');
      close = dialog.querySelector('.admin-history-close');
      close.onclick = () => { if (!busy) dialog.close(); };
      more.onclick = () => load(true);
      dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
      let outside = false;
      function isOutside(event) {
        const rect = dialog.getBoundingClientRect();
        return event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
      }
      dialog.addEventListener('pointerdown', event => { outside = isOutside(event); });
      dialog.addEventListener('click', event => {
        if (outside && isOutside(event) && !busy) dialog.close();
        outside = false;
      });
    }
    dialog.showModal();
    load();
  });
});
