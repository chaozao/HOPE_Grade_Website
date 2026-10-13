const { test } = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/User');
const Class = require('../models/Class');
const Subject = require('../models/Subject');
const Student = require('../models/Student');
const { listStudents } = require('../services/academic');

test('roster combines grade, section and actual subject enrollment before sorting and pagination', async t => {
    const adviser = '1'.repeat(24), cls = '2'.repeat(24), other = '3'.repeat(24), science = '4'.repeat(24);
    const classes = [{ _id: cls, adviser, gradeLevel: 'Grade 7' }, { _id: other, adviser, gradeLevel: 'Grade 8' }];
    const students = [
        { _id: 'a', lastName: 'Zulu', firstName: 'Ana', gradeLevel: 'Grade 7', class: cls, subjects: [science] },
        { _id: 'b', lastName: 'abalos', firstName: 'Maria', gradeLevel: '', class: cls },
        { _id: 'c', lastName: 'Bravo', firstName: 'Ben', gradeLevel: 'Grade 7', class: cls, subjects: [] },
        { _id: 'd', lastName: 'Dubi', firstName: 'Dan', gradeLevel: 'Grade 8', class: other, subjects: [] }
    ];
    function matches(doc, filter) {
        return Object.entries(filter).every(([key, value]) => {
            if (key === '$and') return value.every(item => matches(doc, item));
            if (key === '$or') return value.some(item => matches(doc, item));
            if (value && typeof value === 'object') {
                if ('$in' in value) return value.$in.includes(doc[key] ?? null);
                if ('$exists' in value) return (doc[key] !== undefined) === value.$exists;
            }
            return Array.isArray(doc[key]) ? doc[key].includes(value) : doc[key] === value;
        });
    }
    const query = rows => ({ session: async () => rows, select: async () => rows });
    t.mock.method(User, 'findOne', () => query({ _id: adviser }));
    t.mock.method(Class, 'find', filter => query(classes.filter(row => matches(row, filter))));
    t.mock.method(Subject, 'findById', async () => ({ _id: science, class: cls }));
    t.mock.method(Subject, 'find', () => query([{ _id: science, class: cls }]));
    t.mock.method(Student, 'countDocuments', async filter => students.filter(row => matches(row, filter)).length);
    t.mock.method(Student, 'find', filter => {
        let rows = students.filter(row => matches(row, filter));
        return {
            populate() { return this; },
            collation(value) { assert.equal(value.strength, 2); return this; },
            sort(value) { assert.deepEqual(value, { lastName: 1, firstName: 1, _id: 1 }); rows.sort((a, b) => a.lastName.localeCompare(b.lastName, 'en', { sensitivity: 'base' })); return this; },
            skip(value) { rows = rows.slice(value); return this; },
            limit(value) { rows = rows.slice(0, value); return this; },
            async lean() { return rows.map(row => ({ ...row, class: classes.find(item => item._id === row.class) })); }
        };
    });
    const actor = { userId: adviser, role: 'teacher' };
    const data = await listStudents(actor, { gradeLevel: 'Grade 7', classId: cls, subjectId: science });
    assert.deepEqual(data.students.map(row => row.lastName), ['abalos', 'Zulu']);
    assert.equal(data.total, 2);
    assert.deepEqual((await listStudents(actor, { gradeLevel: 'Grade 8', classId: cls })).students, []);
    assert.equal((await listStudents(actor, { classId: cls })).total, 3);
    assert.equal((await listStudents(actor, {})).total, 4);
    await assert.rejects(listStudents(actor, { subjectId: 'invalid' }), { status: 400 });
});
