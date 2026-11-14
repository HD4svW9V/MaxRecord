import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function reportApp(subscriptions = [], watchers = []) {
    let app;
    class FixedDate extends Date {
        constructor(...args) { super(...(args.length ? args : ['2027-01-05T12:00:00'])); }
    }
    const context = {
        Date: FixedDate, console, setInterval() {}, setTimeout() {}, clearTimeout() {},
        ref: value => ({ value }), computed: fn => ({ get value() { return fn(); } }),
        watch: (sources, callback, options) => { if (options?.flush === 'sync') watchers.push(callback); }, nextTick: async () => {}, onMounted() {},
        createApp: options => ({ mount() { app = options.setup(); } }),
        initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({}),
        Chart: { register() {} }, ChartDataLabels: {},
        doc: () => ({ id: 'test' }), runTransaction: async (db, fn) => fn({ set: (ref, data) => subscriptions.push(data) }), collection: () => ({}), orderBy: () => ({}), limit: count => ({ count }),
        query: (...args) => args.at(-1),
        onSnapshot: (q, options, callback, error) => {
            const sub = { q, options, callback, error, stopped: false };
            subscriptions.push(sub);
            return () => { sub.stopped = true; };
        }
    };
    const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
        .replace(/^\s*import .*?;$/gm, '')
        .replace('categories, weekly, todayHealth,', 'currentUser, listenToFirestore, categories, weekly, todayHealth,');
    vm.runInNewContext(script, context);
    return app;
}

test('PDF defaults to seven days and supports fourteen across year boundaries', () => {
    const app = reportApp();
    assert.equal(app.reportDays.value, 7);
    assert.equal(app.reportData.value.length, 7);
    assert.equal(app.reportData.value[0].date, '2026-12-30');
    assert.equal(app.reportData.value.at(-1).date, '2027-01-05');
    for (let i = 0; i < 7; i++) assert.equal(app.reportX(i), 190 + i * 140);
    app.reportDays.value = 14;
    assert.equal(app.reportData.value.length, 14);
    assert.equal(app.reportData.value[0].date, '2026-12-23');
    assert.equal(app.reportData.value.at(-1).date, '2027-01-05');
    assert.equal(app.reportX(13), 1030);
    assert.equal(app.weekly.value.length, 14);
    assert.equal(app.weekly.value[0].date, '2026-12-23');
});

test('browser and PDF include the same selected data and notes', () => {
    const app = reportApp();
    app.logs.value = [
        { category: 'food', timestamp: '2026-12-23T09:00', details: { type: 'ドライ', dryAction: 'instant', eatenGrams: 50 } },
        ...['2026-12-22', '2026-12-23', '2027-01-05', '2027-01-06'].map(date => ({
            category: 'notice', timestamp: date + 'T10:00', details: { description: date }
        }))
    ];
    assert.equal(app.maxGrams.value, 10);
    assert.equal(app.reportNotes.value.length, 1);
    app.reportDays.value = 14;
    assert.equal(app.reportData.value[0].food, 50);
    assert.equal(app.maxGrams.value, 50);
    assert.equal(app.reportNotes.value.length, 2);
    assert.equal(app.recentNotes.value.length, 2);
    assert.equal(app.reportSegments('pee').length, 13);
    assert.equal(app.reportWaterSegments().length, 0);
    app.reportDays.value = 7;
    assert.equal(app.reportData.value.length, 7);
    assert.equal(app.reportNotes.value.length, 1);
    assert.equal(app.weekly.value.length, 7);
    assert.equal(app.recentNotes.value.length, 1);
});

function snapshot(rows, fromCache = false) {
    return { size: rows.length, metadata: { fromCache, hasPendingWrites: false },
        forEach: fn => rows.forEach((row, i) => fn({ id: String(i), data: () => row })) };
}
const records = (count, date) => Array.from({ length: count }, () => ({
    category: 'toilet', timestamp: date + 'T12:00', details: { type: 'おしっこ' }
}));

test('automatically loads beyond 400 records and includes the entire first day', () => {
    const subs = [], watchers = [];
    const app = reportApp(subs, watchers);
    app.currentUser.value = { uid: 'test' };
    app.reportDays.value = 14;
    app.listenToFirestore();
    assert.equal(subs[0].q.count, 200);
    assert.equal(subs[0].options.includeMetadataChanges, true);
    subs[0].callback(snapshot(records(200, '2027-01-05'), true));
    assert.equal(subs.length, 1);
    assert.equal(app.isOnline.value, false);
    subs[0].callback(snapshot(records(200, '2027-01-05')));
    assert.equal(subs[1].q.count, 400);
    assert.equal(subs[0].stopped, true);
    subs[1].callback(snapshot(records(400, '2026-12-23')));
    assert.equal(subs[2].q.count, 600);
    assert.equal(app.isOnline.value, false);
    assert.equal(app.syncedAt.value, '');
    subs[2].callback(snapshot([...records(599, '2026-12-23'), ...records(1, '2026-12-22')]));
    assert.equal(app.isOnline.value, true);
    assert.equal(app.reportData.value[0].pee, 599);
    assert.equal(app.hasMoreLogs.value, true);
    // A cancelled subscription must not overwrite the complete result.
    subs[0].callback(snapshot([]));
    assert.equal(app.logs.value.length, 600);
    app.reportDays.value = 7;
    watchers.at(-1)();
    assert.equal(app.isOnline.value, false);
    assert.equal(app.syncedAt.value, '');
    subs.at(-1).callback(snapshot(records(2, '2027-01-05')));
    assert.equal(app.hasMoreLogs.value, false);
    assert.equal(app.isOnline.value, true);
});

test('empty history completes, errors keep printing disabled', () => {
    const subs = [];
    const app = reportApp(subs);
    app.currentUser.value = { uid: 'test' };
    app.listenToFirestore();
    subs[0].callback(snapshot([]));
    assert.equal(app.isOnline.value, true);
    assert.equal(app.hasMoreLogs.value, false);
    app.listenToFirestore();
    subs[1].error(new Error('test connection failure'));
    assert.equal(app.isOnline.value, false);
    assert.equal(app.syncedAt.value, '');
});



test('fluid defaults reset to 80 and old records retain their amounts', () => {
    const app = reportApp();
    assert.equal(app.form.value.fluid.fluidMl, 80);
    app.openEditModal({id:'old',category:'fluid',details:{hasFluid:true,fluidMl:100}});
    assert.equal(app.form.value.fluid.fluidMl, 100);
    app.openEditModal({id:'legacy',category:'fluid',details:{hasFluid:true}});
    assert.equal(app.form.value.fluid.fluidMl, 100);
    assert.equal(app.form.value.fluid.hasKidneyMedicine, false);
    app.openModal('fluid');
    assert.equal(app.form.value.fluid.fluidMl, 80);
});

test('each new medicine saves by itself and empty selection is rejected', async () => {
    for (const key of ['hasKidneyMedicine', 'hasAntiemetic']) {
        const saved = [], app = reportApp(saved);
        app.currentUser.value = {uid:'test'};
        app.isOnline.value = true;
        app.openModal('fluid');
        app.form.value.fluid.hasFluid = false;
        app.form.value.fluid[key] = true;
        await app.saveLog();
        assert.equal(saved.length, 1);
        assert.equal(saved[0].details[key], true);
        assert.equal(saved[0].details.fluidMl, '');
        app.openEditModal({...saved[0],id:'saved'});
        assert.equal(app.form.value.fluid[key], true);
        app.openModal('fluid');
        app.form.value.fluid.hasFluid = false;
        await app.saveLog();
        assert.equal(saved.length, 1);
        assert.match(app.bannerNotice.value, /いずれかを入力/);
    }
});

test('daily medicine marks count doses across both report periods', () => {
    const app = reportApp();
    app.logs.value = [
        {category:'fluid',timestamp:'2027-01-05T08:00',details:{hasKidneyMedicine:true}},
        {category:'fluid',timestamp:'2027-01-05T20:00',details:{hasKidneyMedicine:true,hasAntiemetic:true}},
        {category:'fluid',timestamp:'2027-01-04T08:00',details:{hasKidneyMedicine:true}},
        {category:'fluid',timestamp:'2026-12-23T08:00',details:{hasAntiemetic:true}},
        {category:'fluid',timestamp:'2027-01-03T08:00',details:{hasFluid:true}}
    ];
    assert.equal(app.weekly.value.at(-1).kidneyMedicineCount, 2);
    assert.equal(app.weekly.value.at(-1).antiemetic, true);
    assert.equal(app.weekly.value.at(-2).kidneyMedicineCount, 1);
    assert.equal(app.weekly.value.at(-2).antiemetic, false);
    assert.equal(app.weekly.value.at(-3).kidneyMedicineCount, 0);
    app.reportDays.value = 14;
    assert.equal(app.weekly.value[0].antiemetic, true);
    assert.equal(app.reportData.value.at(-1).kidneyMedicineCount, 2);
    app.logs.value.splice(1,1);
    assert.equal(app.reportData.value.at(-1).kidneyMedicineCount, 1);
    assert.equal(app.reportData.value.at(-1).antiemetic, false);
});

