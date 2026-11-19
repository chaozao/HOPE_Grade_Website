window.SF9Report = {
  show(data) {
    const UI = AcademicUI, node = UI.node;
    let dialog = document.getElementById('report-dialog');
    if (!dialog) {
      dialog = node('dialog'); dialog.id = 'report-dialog'; document.body.appendChild(dialog);
      dialog.addEventListener('click', (event) => {
        const rect = dialog.getBoundingClientRect();
        if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
      });
    }
    dialog.replaceChildren(); dialog.setAttribute('aria-labelledby', 'sf9-title');
    const article = node('article'); article.className = 'sf9-report';
    const heading = node('h1', 'SF9 — Learner Progress Report'); heading.id = 'sf9-title'; article.appendChild(heading);
    const meta = node('div', undefined, 'report-meta');
    const fullName = [data.student.lastName + ',', data.student.firstName, data.student.middleName || data.student.middleInitial].filter(Boolean).join(' ');
    for (const [label, value] of [['Student Name', fullName], ['LRN', data.student.lrn || 'Not recorded'], ['Grade', data.gradeLevel || data.student.gradeLevel], ['Section', data.section || data.className], ['Class Adviser', data.adviserName]]) meta.appendChild(node('p', label + ': ' + (value || 'Not recorded')));
    article.appendChild(meta);
    function table(title, columns, rows, mergeLabels = false, className = '') {
      const section = node('section'); section.className = className; section.appendChild(node('h2', title));
      const wrap = node('div', undefined, 'sf9-scroll'), grid = node('table', undefined, 'report-table');
      const thead = node('thead'), tr = node('tr');
      columns.forEach((label) => { const th = node('th', label); th.scope = 'col'; tr.appendChild(th); });
      thead.appendChild(tr); grid.appendChild(thead);
      const body = node('tbody');
      rows.forEach((row, index) => {
        const first = !mergeLabels || !index || rows[index - 1][0] !== row[0];
        const rendered = UI.row(body, first ? row : row.slice(1));
        if (mergeLabels && first) {
          let span = 1;
          while (index + span < rows.length && rows[index + span][0] === row[0]) span++;
          rendered.firstElementChild.rowSpan = span;
        }
      }); grid.appendChild(body); wrap.appendChild(grid); section.appendChild(wrap); article.appendChild(section);
    }
    for (const subject of data.subjects) {
      const months = (data.monthlyAttendance || []).find((item) => item.subjectId === subject.subjectId)?.months || [];
      table('Summary of Attendance - ' + subject.name, ['', ...months.map((month) => month.label), 'Total'],
        [['No. of School Days', 'schoolDays'], ['No. of Days Present', 'present'], ['No. of Days Absent', 'absent'], ['No. of Days Tardy', 'tardy']].map(([label, key]) =>
          [label, ...months.map((month) => month[key]), months.reduce((sum, month) => sum + month[key], 0)]), false, 'sf9-attendance');
    }
    article.appendChild(node('p', data.attendanceNote || 'Attendance summary unavailable. Refresh the report after restarting the backend.', 'report-note'));
    table('Summary of Grades', ['Subject', '1st Term', '2nd Term', '3rd Term', 'Final Grade', 'Remarks'], data.subjects.map((item) => [item.name, ...(item.terms || [null, null, null]), Number(item.grade).toFixed(2), item.grade >= 75 ? 'Passed' : 'Failed']));
    article.appendChild(node('p', 'General Average: ' + Number(data.generalAverage).toFixed(2)));
    const backStart = node('h2', 'Values and Narrative Reports', 'sf9-back-start');
    article.appendChild(backStart);
    article.appendChild(node('p', 'Values: AO - Always Observed; SO - Sometimes Observed; RO - Rarely Observed; NO - Not Observed.', 'report-note'));
    for (const subject of data.subjects) {
      for (const category of ['filipino', 'personal']) {
        const definition = window.CoreValues[category];
        table(subject.name + ' — ' + definition.label, ['Core Values', 'Behavior Statements', '1st Term', '2nd Term', '3rd Term'], definition.items.map(([id, label, statement]) => [label, statement, ...[1, 2, 3].map((term) => data.values.find((record) => record.subjectId === subject.subjectId && record.category === category && record.term === term)?.ratings[id] || '')]), true);
      }
    }
    for (const subject of data.subjects) {
      table('Narrative Report - ' + subject.name, ['Term', 'What Your Child Can Do', 'What Your Child Is Learning to Improve'],
        [1, 2, 3].map((term) => {
          const entry = data.narratives.find((item) => item.subjectId === subject.subjectId && item.term === term);
          return [['1st', '2nd', '3rd'][term - 1], entry?.canDo || '', entry?.improving || ''];
        }), false, 'sf9-narrative');
    }
    article.append(node('p', 'Class Adviser Signature: ____________________'), node('p', 'Generated: ' + new Date(data.generatedAt).toLocaleString(), 'report-note'));
    const tools = node('div', undefined, 'report-tools');
    tools.setAttribute('aria-label', 'SF9 actions');
    tools.append(UI.button('Close', () => dialog.close()), UI.button('Save', () => {
      const style = '@page{size:8.5in 13in;margin:0.4in}@media print{.sf9-back-start{break-before:page}}body{font:14px Arial;color:#17211d;margin:28px}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #bbb;padding:8px;overflow-wrap:anywhere;white-space:pre-wrap}h2{font-size:18px;margin-top:24px}thead{display:table-header-group}tr{break-inside:avoid}.report-meta{display:grid;grid-template-columns:1fr 1fr;gap:8px}.sf9-attendance th:first-child,.sf9-attendance td:first-child{width:150px}.sf9-attendance td,.sf9-attendance th{text-align:center;padding:5px;font-size:11px}.sf9-narrative th:first-child,.sf9-narrative td:first-child{width:45px;text-align:center}.sf9-narrative td{vertical-align:top}.sf9-narrative-entries p{margin:0 0 8px}section h2{text-align:center}@media print{body{margin:0}.sf9-narrative tr{break-inside:auto}}';
      const file = new Blob(['<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SF9 Report</title><style>' + style + '</style></head><body>' + article.outerHTML + '</body></html>'], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(file), link = document.createElement('a');
      link.href = url; link.download = 'SF9-' + String(data.student.lrn || 'student').replace(/[^a-z0-9_-]/gi, '') + '.html';
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }), UI.button('Print', () => window.print()));
    const printHint = node('p', 'Print on long bond paper (8.5 x 13 inches). Select double-sided printing and flip on long edge. Long reports may use additional sheets.', 'report-print-hint');
    dialog.append(article, printHint, tools); dialog.showModal();
  }
};
