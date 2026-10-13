const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const User = require('../models/User');
const Class = require('../models/Class');
const Subject = require('../models/Subject');
const service = require('../services/section-subjects');
const ids = Array.from({ length: 6 }, (_, i) => String(i + 1).repeat(24));
const [admin, adviser, teacher, otherAdviser, sectionId, otherSection] = ids;

test('section assignment permissions, validation and teacher role synchronization', async t => {
    const state = {
        users: [admin, adviser, teacher, otherAdviser].map(id => ({ _id: id, role: id === admin ? 'admin' : 'teacher', isActive: true, teacherRoles: [] })),
        classes: [{ _id: sectionId, adviser, name: 'Grade 10 - Pikachu' }, { _id: otherSection, adviser: otherAdviser, name: 'Other section' }],
        subjects: []
    };
    const matches = (doc, filter) => Object.entries(filter).every(([key, value]) => String(doc[key]) === String(value));
    const query = value => ({ session: async () => value, select() { return this; } });
    for (const [model, key] of [[User, 'users'], [Class, 'classes'], [Subject, 'subjects']]) {
        t.mock.method(model, 'findOne', filter => query(state[key].find(doc => matches(doc, filter))));
        t.mock.method(model, 'findById', id => query(state[key].find(doc => String(doc._id) === String(id))));
        t.mock.method(model, 'find', filter => query(state[key].filter(doc => matches(doc, filter))));
        t.mock.method(model, 'exists', filter => query(state[key].some(doc => matches(doc, filter))));
        t.mock.method(model, 'updateOne', async (filter, update) => {
            const doc = state[key].find(item => matches(item, filter));
            if (doc && update.$set) Object.assign(doc, update.$set);
        });
    }
    t.mock.method(mongoose.connection, 'transaction', async work => work({}));
    t.mock.method(Subject.prototype, 'save', async function () {
        if (!state.subjects.includes(this)) state.subjects.push(this);
        return this;
    });
    const actor = id => ({ userId: id, role: id === admin ? 'admin' : 'teacher' });
    const body = { name: 'Science', teacherId: teacher };
    await assert.rejects(service.save(actor(teacher), sectionId, null, body), { status: 403 });
    await assert.rejects(service.save(actor(adviser), otherSection, null, body), { status: 403 });
    await assert.rejects(service.save({ userId: adviser, role: 'admin' }, sectionId, null, body), { status: 403 });
    await assert.rejects(service.save(actor(adviser), sectionId, null, { ...body, teacherId: admin }), { status: 400 });
    state.users.find(user => user._id === teacher).isActive = false;
    await assert.rejects(service.save(actor(adviser), sectionId, null, body), { status: 400 });
    state.users.find(user => user._id === teacher).isActive = true;

    const { subject } = await service.save(actor(adviser), sectionId, null, body);
    assert.equal(String(subject.teacher), teacher);
    assert.deepEqual(state.users.find(user => user._id === teacher).teacherRoles, ['subject-teacher']);
    await assert.rejects(service.save(actor(adviser), sectionId, null, { ...body, name: ' science ' }), { status: 409 });
    await assert.rejects(service.save(actor(adviser), sectionId, String(subject._id), { ...body, version: 9 }), { status: 409 });
    await assert.rejects(service.save(actor(admin), otherSection, String(subject._id), { ...body, version: 0 }), { status: 404 });
    await service.save(actor(admin), sectionId, String(subject._id), { ...body, teacherId: adviser, version: 0 });
    assert.deepEqual(state.users.find(user => user._id === teacher).teacherRoles, []);
    assert.deepEqual(state.users.find(user => user._id === adviser).teacherRoles, ['class-advisor', 'subject-teacher']);
    assert.equal(subject.__v, 1);
    await service.save(actor(admin), otherSection, null, body);
    assert.equal(state.subjects.length, 2, 'The same subject can belong to different sections');
});
