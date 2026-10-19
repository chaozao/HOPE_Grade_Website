window.SectionSubjects = (function () {
  const UI = AcademicUI;
  let dialog,
    classId,
    data,
    editing,
    busy = false;
  function status(message, error = false) {
    const el = dialog.querySelector('[data-status]');
    el.textContent = message;
    el.classList.toggle('is-error', error);
  }
  function reset() {
    editing = null;
    dialog.querySelector('form').reset();
    dialog.querySelector('[data-save]').textContent = 'Add subject';
    dialog.querySelector('[data-cancel-edit]').hidden = true;
  }
  async function load() {
    data = await UI.api('/section-subjects/' + encodeURIComponent(classId));
    dialog.querySelector('h2').textContent = data.class.name + ' — Subjects & teachers';
    const select = dialog.querySelector('select');
    select.replaceChildren(new Option('Assign later', ''));
    data.teachers.forEach((teacher) =>
      select.appendChild(new Option(teacher.username + ' (' + teacher.email + ')', teacher._id))
    );
    const tbody = dialog.querySelector('tbody');
    tbody.replaceChildren();
    data.subjects.forEach((subject) => {
      const edit = UI.button('Edit assignment', () => {
        reset();
        editing = subject;
        dialog.querySelector('input').value = subject.name;
        if (
          subject.teacher &&
          !data.teachers.some((teacher) => teacher._id === subject.teacher._id)
        ) {
          select.appendChild(
            new Option(
              subject.teacher.username + ' (inactive — select another teacher)',
              subject.teacher._id
            )
          );
        }
        select.value = subject.teacher?._id || '';
        dialog.querySelector('[data-save]').textContent = 'Save assignment';
        dialog.querySelector('[data-cancel-edit]').hidden = false;
        dialog.querySelector('input').focus();
      });
      UI.row(tbody, [subject.name, subject.teacher?.username || 'Not assigned', edit]);
    });
    if (!data.subjects.length) UI.empty(tbody, 'No subjects yet. Add the first subject below.', 3);
    reset();
  }
  async function open(id) {
    if (busy) return;
    classId = id;
    if (!dialog) {
      dialog = UI.node('dialog', undefined, 'section-subject-dialog');
      dialog.setAttribute('aria-labelledby', 'section-subject-title');
      dialog.innerHTML =
        '<div class="section-subject-heading"><h2 id="section-subject-title">Subjects &amp; teachers</h2><button type="button" data-close>Close</button></div>' +
        '<p>Add subjects and assign one teacher to each subject in this section. Student enrollment is managed in Student records.</p>' +
        '<p data-status role="status"></p><button type="button" data-retry hidden>Retry loading</button><fieldset><div class="section-subject-table"><table><thead><tr><th scope="col">Subject</th><th scope="col">Teacher</th><th scope="col">Action</th></tr></thead><tbody></tbody></table></div>' +
        '<form><label for="section-subject-name">Subject name<input id="section-subject-name" required maxlength="100" placeholder="e.g. Science"></label><label for="section-subject-teacher">Subject teacher<select id="section-subject-teacher"></select></label><div class="section-subject-actions"><button type="submit" data-save>Add subject</button><button type="button" data-cancel-edit hidden>Cancel edit</button></div></form></fieldset>';
      document.body.appendChild(dialog);
      dialog.querySelector('[data-close]').addEventListener('click', () => {
        if (!busy) dialog.close();
      });
      dialog.addEventListener('cancel', (event) => {
        if (busy) event.preventDefault();
      });
      dialog.querySelector('[data-cancel-edit]').addEventListener('click', reset);
      dialog.querySelector('[data-retry]').addEventListener('click', () => open(classId));
      dialog.querySelector('form').addEventListener('submit', async (event) => {
        event.preventDefault();
        if (busy) return;
        busy = true;
        dialog.querySelector('fieldset').disabled = true;
        status('Saving assignment…');
        let saved = false;
        try {
          await UI.api(
            '/section-subjects/' +
              encodeURIComponent(classId) +
              '/subjects' +
              (editing ? '/' + encodeURIComponent(editing._id) : ''),
            {
              method: editing ? 'PUT' : 'POST',
              body: JSON.stringify({
                name: dialog.querySelector('input').value.trim(),
                teacherId: dialog.querySelector('select').value,
                version: editing?.__v || 0
              })
            }
          );
          saved = true;
          document.dispatchEvent(new Event('section-subjects-saved'));
          await load();
          status('Assignment saved.');
        } catch (error) {
          status(
            (saved ? 'Assignment saved, but the list could not refresh. ' : '') + error.message,
            true
          );
          if (saved || error.status === 409) {
            dialog.querySelector('[data-retry]').hidden = false;
            return;
          }
        } finally {
          busy = false;
          dialog.querySelector('fieldset').disabled = !dialog.querySelector('[data-retry]').hidden;
        }
      });
    }
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('h2').textContent = 'Subjects & teachers';
    dialog.querySelector('tbody').replaceChildren();
    dialog.querySelector('[data-retry]').hidden = true;
    dialog.querySelector('fieldset').disabled = true;
    busy = true;
    status('Loading section subjects…');
    try {
      await load();
      status('');
      dialog.querySelector('fieldset').disabled = false;
    } catch (error) {
      status(error.message, true);
      dialog.querySelector('[data-retry]').hidden = false;
    } finally {
      busy = false;
    }
  }
  return { open };
})();
