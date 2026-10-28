window.ClassBrowser = (function () {
  const termColumns = [
    'LRN',
    'Full Names',
    'Written / Oral Works',
    'Product / Performance Tasks',
    'Examination',
    'Initial Grade',
    'Term Grade',
    'Descriptor'
  ];
  const categories = [
    ['writtenOral', 'Written / Oral Works'],
    ['performanceTasks', 'Product / Performance Tasks'],
    ['examination', 'Examination']
  ];
  // WS WEIGHTS: Written / Oral Works = 20%, Product / Performance Tasks = 60%.
  // Keep these numeric for calculations; the table header adds the % sign below.
  const categoryWeights = { writtenOral: 20, performanceTasks: 60 };
  const finalColumns = [
    'Learners Name',
    '1st Term',
    '2nd Term',
    '3rd Term',
    'Final Grade',
    'Descriptor',
    'Remarks'
  ];
  const fullName = (student) =>
    [student.lastName + ',', student.firstName, student.middleName].filter(Boolean).join(' ');
  function finalAverage(terms) {
    const grades = [1, 2, 3].map((term) => terms[term]?.termGrade);
    if (
      grades.some(
        (grade) => typeof grade !== 'number' || !Number.isFinite(grade) || grade < 0 || grade > 100
      )
    )
      return null;
    return grades.reduce((sum, grade) => sum + grade, 0) / 3;
  }
  function create(root) {
    const UI = AcademicUI;
    let subjects = [],
      selected = null,
      data = null,
      version = 0;
    const scoreDrafts = new Map();
    window.addEventListener?.('beforeunload', (event) => {
      if (scoreDrafts.size) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    const overview = UI.node('div'),
      detail = UI.node('div');
    const status = UI.node('p', '', 'workflow-status');
    status.id = 'class-browser-status';
    status.setAttribute('role', 'status');
    status.hidden = true;
    const retry = UI.button('Retry loading class', () =>
      selected ? openSubject(selected) : show()
    );
    retry.id = 'class-browser-retry';
    retry.hidden = true;
    root.append(status, retry, overview, detail);
    function message(text = '', error = false) {
      status.textContent = text;
      status.hidden = !text;
      status.classList.toggle('is-error', error);
      retry.hidden = !error;
    }
    function table(container, title, columns, id, groups) {
      const section = UI.node('section', undefined, 'grades-table-section class-browser-table');
      const heading = UI.node('div', undefined, 'table-header');
      heading.appendChild(UI.node('h2', title));
      const scroll = UI.node('div', undefined, 'class-table-scroll');
      scroll.tabIndex = 0;
      scroll.setAttribute('role', 'region');
      scroll.setAttribute('aria-label', title);
      const grid = UI.node('table', undefined, 'grades-table'),
        head = UI.node('thead'),
        header = UI.node('tr'),
        body = UI.node('tbody');
      body.id = id;
      if (groups) {
        const numbers = UI.node('tr'),
          maxima = UI.node('tr');
        columns.forEach((label, index) => {
          const cell = UI.node('th', label);
          header.appendChild(cell);
          if (index < 2 || index > 4) {
            cell.rowSpan = 3;
            cell.scope = 'col';
            return;
          }
          const group = groups[index - 2];
          cell.scope = 'colgroup';
          cell.colSpan = Math.max(1, group.activities.length) + (group.summary ? 3 : 0);
          cell.className = 'activity-group-heading';
          const add = UI.button('+ Add column', group.add);
          add.disabled = group.locked;
          add.setAttribute('aria-label', 'Add activity to ' + label);
          const groupTitle = UI.node('div', undefined, 'activity-group-toolbar');
          groupTitle.append(UI.node('span', label), add);
          cell.replaceChildren(groupTitle);
          const items = group.activities.length ? group.activities : [null];
          items.forEach((activity, number) => {
            const numbered = UI.node(
              'th',
              activity ? String(number + 1) : '\u2014',
              'activity-number'
            );
            numbered.scope = 'col';
            numbered.title = activity?.title || 'No activities yet';
            if (activity) {
              numbered.appendChild(UI.node('span', activity.title, 'activity-title'));
            }
            numbers.appendChild(numbered);
            // Generates <th class="activity-max" title="Maximum points">...</th>.
            // The number comes from the saved activity, not a fixed score in this file.
            const max = UI.node(
              'th',
              activity ? String(activity.maxScore) : '\u2014',
              'activity-max'
            );
            max.title = 'Maximum points';
            maxima.appendChild(max);
          });
          if (group.summary) {
            ['Total', 'PS', 'WS'].forEach((label, index) => {
              const heading = UI.node('th', label, 'activity-number activity-summary');
              heading.scope = 'col';
              heading.title = ['Total points', 'Percentage Score', 'Weighted Score'][index];
              numbers.appendChild(heading);
              // SUMMARY MAXIMUM HEADERS: Total = sum of activity limits, PS = 100,
              // WS = the configured percentage, displayed as "20%" or "60%".
              const weightedScoreMaximum = group.weight === null ? '\u2014' : group.weight + '%';
              const value = [group.maximum, 100, weightedScoreMaximum][index];
              maxima.appendChild(UI.node('th', String(value), 'activity-max activity-summary'));
            });
          }
        });
        head.append(header, numbers, maxima);
      } else {
        columns.forEach((label) => {
          const cell = UI.node('th', label);
          cell.scope = 'col';
          header.appendChild(cell);
        });
        head.appendChild(header);
      }
      grid.append(head, body);
      scroll.appendChild(grid);
      section.append(heading, scroll);
      container.appendChild(section);
      return body;
    }
    async function show() {
      selected = null;
      data = null;
      const request = ++version;
      overview.hidden = false;
      detail.hidden = true;
      overview.replaceChildren();
      message(subjects.length ? 'Loading subjects…' : '');
      const body = table(
        overview,
        'Subject Overview',
        ['Subject', 'Class and Section', 'Total of Students', 'Passing Rate'],
        'class-subjects-tbody'
      );
      if (!subjects.length) {
        UI.empty(body, 'No teaching assignments available.', 4);
        return;
      }
      const results = await Promise.allSettled(
        subjects.map((subject) =>
          UI.api('/teacher/subjects/' + encodeURIComponent(subject._id) + '/roster')
        )
      );
      if (request !== version) return;
      let failed = false;
      subjects.forEach((subject, index) => {
        const result = results[index];
        const roster = result.status === 'fulfilled' ? result.value : null;
        failed ||= !roster;
        const name = UI.node('div'),
          link = UI.node('a', subject.name, 'class-subject-link');
        link.href = '#class';
        link.addEventListener('click', (event) => {
          event.preventDefault();
          openSubject(subject);
        });
        name.appendChild(link);
        UI.row(body, [
          name,
          subject.className || '—',
          roster ? roster.totalStudents : (subject.studentCount ?? '—'),
          roster
            ? roster.passingRate == null
              ? 'Not graded'
              : roster.passingRate + '%'
            : 'Unavailable'
        ]);
      });
      const note = UI.node(
        'p',
        'Passing rate is based on available recorded grades (75 and above).',
        'table-footnote'
      );
      overview.appendChild(note);
      message(failed ? 'Some grade summaries could not load. Retry to refresh them.' : '', failed);
    }
    async function openSubject(subject) {
      selected = subject;
      data = null;
      const request = ++version;
      overview.hidden = true;
      detail.hidden = false;
      detail.replaceChildren();
      let scoreInputs = [];
      const toolbar = UI.node('div', undefined, 'workflow-toolbar');
      const back = UI.button('', show);
      back.className += ' class-back-button';
      back.setAttribute('aria-label', 'Back to subjects');
      back.title = 'Back to subjects';
      const arrow = UI.node('i', undefined, 'bi bi-arrow-left-square');
      arrow.setAttribute('aria-hidden', 'true');
      back.appendChild(arrow);
      toolbar.appendChild(back);
      const label = UI.node('label', 'Grading period '),
        select = UI.node('select');
      select.id = 'class-term-select';
      ['1st Term', '2nd Term', '3rd Term', 'Final Grades'].forEach((name, index) =>
        select.appendChild(new Option(name, String(index + 1)))
      );
      label.appendChild(select);
      detail.appendChild(toolbar);
      const manage = UI.button('Manage columns', manageColumns);
      manage.disabled = true;
      const toolbarActions = UI.node('div', undefined, 'class-toolbar-actions');
      toolbarActions.append(manage, label);
      toolbar.appendChild(toolbarActions);
      const dialog = UI.node('dialog', undefined, 'activity-dialog');
      dialog.setAttribute('aria-labelledby', 'activity-editor-title');
      const editor = UI.node('form', undefined, 'activity-editor');
      editor.noValidate = true;
      const manager = UI.node('form', undefined, 'activity-manager');
      manager.hidden = true;
      dialog.append(manager, editor);
      detail.appendChild(dialog);
      const editorTitle = UI.node('h3'),
        titleLabel = UI.node('label', 'Activity name'),
        titleInput = UI.node('input');
      editorTitle.id = 'activity-editor-title';
      titleInput.required = true;
      titleInput.maxLength = 100;
      titleLabel.appendChild(titleInput);
      const maxLabel = UI.node('label', 'Maximum points'),
        maxInput = UI.node('input');
      Object.assign(maxInput, {
        type: 'number',
        min: '1',
        max: '10000',
        step: '1',
        required: true
      });
      maxLabel.appendChild(maxInput);
      const save = UI.node('button', 'Add activity', 'filter-btn');
      save.type = 'submit';
      const cancel = UI.button('Cancel', () => {
        dialog.close();
      });
      const editorStatus = UI.node('p');
      editorStatus.setAttribute('role', 'status');
      const remove = UI.button('Delete column', () => persist(true));
      remove.className += ' activity-delete';
      const footer = UI.node('div', undefined, 'activity-editor-footer'),
        actions = UI.node('div', undefined, 'activity-editor-actions');
      actions.append(cancel, save);
      footer.append(actions);
      editor.append(editorTitle, titleLabel, maxLabel, editorStatus, footer);
      let editingCategory = '',
        editingActivity = null,
        saving = false;
      dialog.addEventListener('cancel', (event) => {
        if (saving) event.preventDefault();
      });
      function outsideDialog(event) {
        const bounds = dialog.getBoundingClientRect();
        return (
          event.target === dialog &&
          (event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom)
        );
      }
      let pressedOutside = false;
      dialog.addEventListener('pointerdown', (event) => {
        pressedOutside = outsideDialog(event);
      });
      dialog.addEventListener('click', (event) => {
        if (!saving && pressedOutside && outsideDialog(event)) dialog.close();
        pressedOutside = false;
      });
      function manageColumns() {
        if (!data || saving || select.value === '4') return;
        dialog.classList.toggle('managing-columns', true);
        editor.hidden = true;
        manager.hidden = false;
        manager.replaceChildren();
        const title = UI.node('h3', 'Manage columns');
        title.id = 'activity-manager-title';
        dialog.setAttribute('aria-labelledby', title.id);
        manager.append(
          title,
          UI.node(
            'p',
            select.selectedOptions[0].textContent +
              ' activities. Update names and maximum points, then save your changes.',
            'content-subtitle'
          )
        );
        const refreshUndo = [];
        const drafts = [],
          controls = [];
        const categoryLabel = UI.node('label', 'Activity category', 'activity-manager-category');
        const categorySelect = UI.node('select');
        categorySelect.id = 'activity-manager-category';
        const placeholder = new Option('Choose an activity category', '');
        placeholder.disabled = true;
        categorySelect.appendChild(placeholder);
        categories.forEach(([key, label]) => {
          categorySelect.appendChild(new Option(key === 'examination' ? 'Examinations' : label, key));
        });
        categorySelect.value = '';
        categoryLabel.appendChild(categorySelect);
        manager.appendChild(categoryLabel);
        controls.push(categorySelect);
        const sections = new Map();
        function showCategory(key) {
          categorySelect.value = key;
          sections.forEach((section, category) => { section.hidden = category !== key; });
          commit.hidden = !key;
        }
        categorySelect.addEventListener('change', () => showCategory(categorySelect.value));
        const locked = data.gradeStatus === 'finalized';
        categories.forEach(([key, label]) => {
          const activities = (data.activities || []).filter(
            (item) => item.term === Number(select.value) && item.category === key
          );
          const section = UI.node('section', undefined, 'activity-manager-group');
          sections.set(key, section);
          section.hidden = key !== categorySelect.value;
          section.appendChild(UI.node('h4', label));
          if (!activities.length)
            section.appendChild(UI.node('p', 'No columns yet.', 'content-subtitle'));
          activities.forEach((activity, index) => {
            const row = UI.node('div', undefined, 'activity-manager-row');
            const info = UI.node('div', undefined, 'activity-manager-info');
            const nameLabel = UI.node('label', index + 1 + '. Activity name'),
              nameInput = UI.node('input');
            Object.assign(nameInput, {
              value: activity.title,
              required: true,
              maxLength: 100,
              disabled: locked
            });
            nameLabel.appendChild(nameInput);
            const pointsLabel = UI.node('label', 'Maximum points'),
              pointsInput = UI.node('input');
            Object.assign(pointsInput, {
              type: 'number',
              value: String(activity.maxScore),
              min: '1',
              max: '10000',
              step: '1',
              required: true,
              disabled: locked
            });
            pointsLabel.appendChild(pointsInput);
            info.append(nameLabel, pointsLabel);
            drafts.push({ id: activity._id, category: key, nameInput, pointsInput });
            controls.push(nameInput, pointsInput);
            const undo = UI.button('Undo', () => {
              if (saving || locked || undo.disabled) return;
              const current = data.activities.find((item) => item._id === activity._id);
              nameInput.value = current.title;
              pointsInput.value = String(current.maxScore);
              changed();
            });
            undo.className += ' activity-undo';
            undo.setAttribute('aria-label', 'Undo changes to ' + activity.title);
            function changed() {
              const current = data.activities.find((item) => item._id === activity._id);
              undo.disabled = saving || locked || !current ||
                (nameInput.value === current.title && pointsInput.value === String(current.maxScore));
            }
            refreshUndo.push(changed);
            changed();
            nameInput.addEventListener('input', changed);
            pointsInput.addEventListener('input', changed);
            undo.title = 'Restore this row to its saved name and maximum points';
            const deleteColumn = UI.button('Delete', async () => {
              if (saving || locked) return;
              saving = true;
              controls.forEach((control) => { control.disabled = true; });
              managerStatus.textContent = 'Deleting column...';
              try {
                const result = await UI.api(
                  '/teacher/subjects/' + encodeURIComponent(subject._id) +
                    '/activities/' + encodeURIComponent(activity._id),
                  { method: 'DELETE', body: JSON.stringify({ version: data.gradeVersion || 0 }) }
                );
                if (request !== version) return;
                data.activities = result.activities;
                data.gradeVersion = result.gradeVersion;
                for (const draftKey of scoreDrafts.keys()) {
                  if (draftKey.startsWith(subject._id + ':') && draftKey.endsWith(':' + activity._id))
                    scoreDrafts.delete(draftKey);
                }
                drafts.splice(drafts.findIndex((draft) => draft.id === activity._id), 1);
                row.remove();
                if (!drafts.some((draft) => draft.category === key))
                  section.appendChild(UI.node('p', 'No columns yet.', 'content-subtitle'));
                render();
                managerStatus.textContent = 'Column deleted.';
              } catch (error) {
                if (request === version) managerStatus.textContent = 'Could not delete column: ' + error.message;
              } finally {
                saving = false;
                controls.forEach((control) => { control.disabled = locked; });
                commit.disabled = locked || !drafts.length;
                refreshUndo.forEach((refresh) => refresh());
                refreshScoreControls();
              }
            });
            deleteColumn.className += ' activity-delete';
            deleteColumn.disabled = locked;
            deleteColumn.setAttribute('aria-label', 'Delete ' + activity.title);
            controls.push(undo, deleteColumn);
            const rowActions = UI.node('div', undefined, 'activity-manager-row-actions');
            rowActions.append(undo, deleteColumn);
            row.append(info, rowActions);
            section.appendChild(row);
          });
          manager.appendChild(section);
        });
        const managerStatus = UI.node('p');
        managerStatus.setAttribute('role', 'status');
        const buttons = UI.node('div', undefined, 'activity-editor-actions');
        const dismiss = UI.button('Cancel', () => dialog.close());
        const commit = UI.node('button', 'Save changes', 'filter-btn');
        commit.type = 'submit';
        commit.hidden = true;
        commit.disabled = locked || !drafts.length;
        controls.push(dismiss, commit);
        buttons.append(dismiss, commit);
        manager.append(managerStatus, buttons);
        // Reveal invalid fields before browser validation tries to focus them.
        manager.noValidate = true;
        manager.onsubmit = async (event) => {
          event.preventDefault();
          if (saving || locked || !categorySelect.value) return;
          const invalid = drafts.find((draft) =>
            !draft.nameInput.value.trim() ||
            draft.nameInput.checkValidity?.() === false ||
            draft.pointsInput.checkValidity?.() === false
          );
          if (invalid) showCategory(invalid.category);
          if (!manager.reportValidity()) return;
          const changes = drafts
            .map((draft) => ({
              id: draft.id,
              title: draft.nameInput.value.trim(),
              maxScore: Number(draft.pointsInput.value)
            }))
            .filter((draft) => {
              const current = data.activities.find((item) => item._id === draft.id);
              return (
                current && (current.title !== draft.title || current.maxScore !== draft.maxScore)
              );
            });
          if (changes.some((item) => !item.title)) {
            managerStatus.textContent = 'Enter an activity name for every column.';
            return;
          }
          saving = true;
          controls.forEach((control) => {
            control.disabled = true;
          });
          managerStatus.textContent = 'Saving changes...';
          let completed = 0;
          try {
            for (const change of changes) {
              const result = await UI.api(
                '/teacher/subjects/' +
                  encodeURIComponent(subject._id) +
                  '/activities/' +
                  encodeURIComponent(change.id),
                {
                  method: 'PUT',
                  body: JSON.stringify({
                    title: change.title,
                    maxScore: change.maxScore,
                    version: data.gradeVersion || 0
                  })
                }
              );
              if (request !== version) return;
              data.activities = result.activities;
              data.gradeVersion = result.gradeVersion;
              completed++;
            }
            dialog.close();
            render();
            message(changes.length ? 'Column changes saved.' : 'No changes to save.');
          } catch (error) {
            if (request === version) {
              render();
              managerStatus.textContent =
                (completed ? completed + ' column(s) saved. ' : '') + error.message;
            }
          } finally {
            saving = false;
            controls.forEach((control) => {
              control.disabled = false;
            });
            refreshUndo.forEach((refresh) => refresh());
          }
        };
        if (!dialog.open) dialog.showModal();
      }
      function showEditor() {
        dialog.classList.toggle('managing-columns', false);
        manager.hidden = true;
        editor.hidden = false;
        titleInput.setAttribute('aria-invalid', 'false');
        maxInput.setAttribute('aria-invalid', 'false');
        dialog.setAttribute('aria-labelledby', 'activity-editor-title');
        if (!dialog.open) dialog.showModal();
        titleInput.focus();
      }
      function editActivity(activity) {
        if (saving || data.gradeStatus === 'finalized') return;
        editingActivity = activity;
        titleInput.value = activity.title;
        maxInput.value = activity.maxScore;
        editorTitle.textContent = 'Edit column';
        save.textContent = 'Save changes';
        remove.hidden = false;
        titleInput.classList.toggle('state-error', false);
        maxInput.classList.toggle('state-error', false);
        editorStatus.textContent = '';
        showEditor();
      }
      function addActivity(category, label, count) {
        if (saving || data.gradeStatus === 'finalized') return;
        editingActivity = null;
        remove.hidden = true;
        save.textContent = 'Add activity';
        editingCategory = category;
        editorTitle.textContent = 'Add ' + label + ' activity';
        titleInput.value = '';
        titleInput.placeholder = label + ' ' + (count + 1);
        maxInput.value = '';
        titleInput.classList.toggle('state-error', false);
        maxInput.classList.toggle('state-error', false);
        editorStatus.textContent = '';
        showEditor();
      }
      editor.addEventListener('submit', (event) => {
        event.preventDefault();
        return persist(false);
      });
      async function persist(deleting) {
        if (saving || (deleting && !editingActivity)) return;
        if (!deleting) {
          const missingName = !titleInput.value.trim();
          const invalidMax =
            !String(maxInput.value).trim() ||
            !Number.isInteger(Number(maxInput.value)) ||
            Number(maxInput.value) < 1 ||
            Number(maxInput.value) > 10000;
          titleInput.classList.toggle('state-error', missingName);
          titleInput.setAttribute('aria-invalid', String(missingName));
          maxInput.classList.toggle('state-error', invalidMax);
          maxInput.setAttribute('aria-invalid', String(invalidMax));
          if (missingName || invalidMax) {
            editorStatus.textContent = missingName
              ? 'Activity name is required. Enter a name and maximum points before saving.'
              : 'Maximum points is required and must be a whole number from 1 to 10000.';
            (missingName ? titleInput : maxInput).focus();
            return;
          }
          if (!editor.reportValidity()) return;
        }
        saving = true;
        save.disabled = cancel.disabled = remove.disabled = select.disabled = back.disabled = true;
        titleInput.disabled = maxInput.disabled = true;
        editorStatus.textContent = deleting ? 'Deleting column...' : 'Saving activity...';
        try {
          const result = await UI.api(
            '/teacher/subjects/' +
              encodeURIComponent(subject._id) +
              '/activities' +
              (editingActivity ? '/' + encodeURIComponent(editingActivity._id) : ''),
            {
              method: deleting ? 'DELETE' : editingActivity ? 'PUT' : 'POST',
              body: JSON.stringify({
                term: Number(select.value),
                category: editingCategory,
                title: titleInput.value.trim(),
                maxScore: Number(maxInput.value),
                version: data.gradeVersion || 0
              })
            }
          );
          if (request !== version) return;
          data.activities = result.activities;
          data.gradeVersion = result.gradeVersion;
          if (deleting) {
            for (const key of scoreDrafts.keys()) {
              if (key.startsWith(subject._id + ':') && key.endsWith(':' + editingActivity._id))
                scoreDrafts.delete(key);
            }
          }
          dialog.close();
          manager.replaceChildren();
          render();
          message(
            deleting ? 'Column deleted.' : editingActivity ? 'Column updated.' : 'Activity added.'
          );
        } catch (error) {
          if (request === version) editorStatus.textContent = error.message;
        } finally {
          saving = false;
          save.disabled =
            cancel.disabled =
            remove.disabled =
            select.disabled =
            back.disabled =
              false;
          titleInput.disabled = maxInput.disabled = false;
        }
      }
      const content = UI.node('div');
      detail.appendChild(content);
      const scoreTools = UI.node('div', undefined, 'workflow-toolbar score-tools');
      const scoreStatus = UI.node('p');
      scoreStatus.setAttribute('role', 'status');
      const saveScores = UI.button('Save scores', saveActivityScores);
      saveScores.id = 'save-activity-scores';
      scoreTools.append(scoreStatus, saveScores);
      detail.appendChild(scoreTools);
      let summaryUpdates = [];
      function refreshScoreControls() {
        summaryUpdates.forEach((update) => update());
        const invalid = scoreInputs.some((field) => field.invalid);
        const dirty = scoreInputs.some((field) => scoreDrafts.has(field.key));
        saveScores.disabled = saving || data?.gradeStatus === 'finalized' || !dirty || invalid;
        scoreStatus.textContent = invalid
          ? 'Fix the highlighted scores before saving.'
          : dirty
            ? 'Unsaved scores. Click Save scores when finished.'
            : '';
      }
      function summaryCells(student, group) {
        const cells = ['Total', 'PS', 'WS'].map((label) => {
          const cell = UI.node('span', '\u2014', 'activity-summary-value');
          cell.setAttribute('aria-label', fullName(student) + ' - ' + group.label + ' ' + label);
          return cell;
        });
        const update = () => {
          const fields = scoreInputs.filter((field) =>
            field.student === student && group.activities.includes(field.activity)
          );
          const complete = fields.length > 0 && fields.every((field) =>
            !field.invalid && field.input.value !== ''
          );
          const total = complete ? fields.reduce((sum, field) => sum + Number(field.input.value), 0) : null;
          const ps = total !== null && group.maximum > 0 ? total / group.maximum * 100 : null;
          const ws = ps !== null && group.weight !== null ? ps * group.weight / 100 : null;
          [total, ps, ws].forEach((value, index) => {
            cells[index].textContent = value === null ? '\u2014' : String(Number(value.toFixed(2)));
          });
          cells[2].title = group.weight === null ? 'Category weight has not been configured.' : 'Percentage Score × category weight';
        };
        summaryUpdates.push(update);
        update();
        return cells;
      }
      function scoreCell(student, activity) {
        const cell = UI.node('div', undefined, 'activity-score-cell');
        const input = UI.node('input', undefined, 'activity-score-input');
        const error = UI.node('small', '', 'activity-score-error');
        const key = subject._id + ':' + student.studentId + ':' + activity._id;
        const original = student.activityScores?.[activity._id] ?? null;
        const draft = scoreDrafts.get(key);
        Object.assign(input, {
          type: 'number',
          min: '0',
          max: String(activity.maxScore),
          step: 'any',
          value: draft ? draft.raw : original === null ? '' : String(original),
          placeholder: '\u2014',
          disabled: data.gradeStatus === 'finalized'
        });
        input.setAttribute(
          'aria-label',
          fullName(student) + ' - ' + activity.title + ' (maximum ' + activity.maxScore + ')'
        );
        error.id = 'score-error-' + student.studentId + '-' + activity._id;
        error.hidden = true;
        input.setAttribute('aria-describedby', error.id);
        const field = { input, key, student, activity, invalid: false };
        scoreInputs.push(field);
        function validate(changed) {
          const raw = input.value,
            number = Number(raw);
          field.invalid =
            Boolean(input.validity?.badInput) ||
            (raw !== '' && (!Number.isFinite(number) || number < 0 || number > activity.maxScore));
          input.classList.toggle('state-error', field.invalid);
          input.setAttribute('aria-invalid', String(field.invalid));
          error.textContent = field.invalid ? 'Enter 0 to ' + activity.maxScore + ' points.' : '';
          error.hidden = !field.invalid;
          if (changed) {
            if (!field.invalid && (raw === '' ? null : number) === original)
              scoreDrafts.delete(key);
            else scoreDrafts.set(key, { raw });
          }
          refreshScoreControls();
        }
        input.addEventListener('input', () => validate(true));
        validate(false);
        cell.append(input, error);
        return cell;
      }
      async function saveActivityScores() {
        if (
          saving ||
          data.gradeStatus === 'finalized' ||
          scoreInputs.some((field) => field.invalid)
        )
          return;
        const changed = scoreInputs.filter((field) => scoreDrafts.has(field.key));
        if (!changed.length) return;
        const entries = new Map();
        changed.forEach((field) => {
          if (!entries.has(field.student.studentId))
            entries.set(field.student.studentId, {
              studentId: field.student.studentId,
              scores: {}
            });
          entries.get(field.student.studentId).scores[field.activity._id] =
            field.input.value === '' ? null : Number(field.input.value);
        });
        saving = true;
        select.disabled = back.disabled = manage.disabled = true;
        scoreInputs.forEach((field) => {
          field.input.disabled = true;
        });
        refreshScoreControls();
        scoreStatus.textContent = 'Saving scores...';
        try {
          const result = await UI.api(
            '/teacher/subjects/' + encodeURIComponent(subject._id) + '/activity-scores',
            {
              method: 'PUT',
              body: JSON.stringify({
                version: data.gradeVersion || 0,
                term: Number(select.value),
                grades: Array.from(entries.values())
              })
            }
          );
          if (request !== version) return;
          data.gradeVersion = result.gradeVersion;
          changed.forEach((field) => {
            field.student.activityScores ||= {};
            field.student.activityScores[field.activity._id] = entries.get(
              field.student.studentId
            ).scores[field.activity._id];
            scoreDrafts.delete(field.key);
          });
          render();
          scoreStatus.textContent = 'Scores saved.';
        } catch (error) {
          if (request === version)
            scoreStatus.textContent = 'Could not save scores: ' + error.message;
        } finally {
          saving = false;
          select.disabled = back.disabled = manage.disabled = false;
          scoreInputs.forEach((field) => {
            field.input.disabled = data.gradeStatus === 'finalized';
          });
          saveScores.disabled =
            data.gradeStatus === 'finalized' ||
            !scoreInputs.some((field) => scoreDrafts.has(field.key)) ||
            scoreInputs.some((field) => field.invalid);
        }
      }
      function render() {
        content.replaceChildren();
        scoreInputs = [];
        summaryUpdates = [];
        const final = select.value === '4';
        scoreTools.hidden = final;
        manage.hidden = final;
        manage.disabled = false;
        const groups = categories.map(([key, label]) => {
          const activities = (data.activities || []).filter(
            (activity) => activity.term === Number(select.value) && activity.category === key
          );
          return {
            activities,
            label,
            summary: key !== 'examination',
            maximum: activities.reduce((sum, activity) => sum + activity.maxScore, 0),
            weight: categoryWeights[key] ?? null,
            locked: data.gradeStatus === 'finalized',
            add: () => addActivity(key, label, activities.length)
          };
        });
        const body = table(
          content,
          subject.name + ' — ' + subject.className + ' · ' + select.selectedOptions[0].textContent,
          final ? finalColumns : termColumns,
          'class-grades-tbody',
          final ? null : groups
        );
        const rows = [...data.roster].sort((a, b) =>
          fullName(a).localeCompare(fullName(b), 'en', { sensitivity: 'base' })
        );
        rows.forEach((student) => {
          const terms = student.terms || {};
          if (final) {
            const average = finalAverage(terms);
            UI.row(body, [
              fullName(student),
              terms[1]?.termGrade,
              terms[2]?.termGrade,
              terms[3]?.termGrade,
              average === null ? null : Number(average.toFixed(1)),
              average === null ? null : student.finalDescriptor,
              average === null ? 'Incomplete' : average >= 75 ? 'Passed' : 'Failed'
            ]);
          } else {
            const term = terms[select.value] || {};
            const activityValues = groups.flatMap((group) => {
              const values = group.activities.length
                ? group.activities.map((activity) => scoreCell(student, activity))
                : [null];
              if (group.summary) values.push(...summaryCells(student, group));
              return values;
            });
            UI.row(body, [
              student.lrn || '—',
              fullName(student),
              ...activityValues,
              term.initialGrade,
              term.termGrade,
              term.descriptor ?? 'Not graded'
            ]);
          }
        });
        refreshScoreControls();
        if (!rows.length)
          UI.empty(
            body,
            'No students enrolled in this subject. Registered learners appear here once enrolled.',
            final
              ? 7
              : 5 + groups.reduce((count, group) => count + Math.max(1, group.activities.length) + (group.summary ? 3 : 0), 0)
          );
        if (final)
          content.appendChild(
            UI.node(
              'p',
              'Final Grade is the equal average of all three term grades, displayed to one decimal place. All three terms must be complete.',
              'table-footnote'
            )
          );
        if (rows.length && rows.every((student) => !student.terms))
          content.appendChild(
            UI.node('p', 'Term grades have not been recorded yet.', 'table-footnote')
          );
      }
      select.disabled = true;
      select.addEventListener('change', () => {
        dialog.close();
        render();
      });
      message('Loading learners…');
      try {
        const result = await UI.api(
          '/teacher/subjects/' + encodeURIComponent(subject._id) + '/roster'
        );
        if (request !== version) return;
        data = result;
        render();
        select.disabled = false;
        message();
      } catch (error) {
        if (request === version) message('Could not load learners: ' + error.message, true);
      }
    }
    return {
      show,
      setSubjects(value) {
        subjects = value;
        selected = null;
        data = null;
        version++;
      }
    };
  }
  return { create };
})();
