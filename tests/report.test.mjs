import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function reportApp() {
    let app;
    class FixedDate extends Date {
        constructor(...args) { super(...(args.length ? args : ['2027-01-05T12:00:00'])); }
    }
    const context = {
        Date: FixedDate, console, setInterval() {},
        ref: value => ({ value }), computed: fn => ({ get value() { return fn(); } }),
        watch() {}, nextTick: async () => {}, onMounted() {},
        createApp: options => ({ mount() { app = options.setup(); } }),
        initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({}),
        Chart: { register() {} }, ChartDataLabels: {}
    };
    const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
        .replace(/^\s*import .*?;$/gm, '');
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
    assert.equal(app.weekly.value.length, 7);
    assert.equal(app.weekly.value[0].date, '2026-12-30');
});

test('PDF includes older data and notes only in the selected period', () => {
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
    assert.equal(app.recentNotes.value.length, 1);
    assert.equal(app.reportSegments('pee').length, 13);
    assert.equal(app.reportWaterSegments().length, 0);
    app.reportDays.value = 7;
    assert.equal(app.reportData.value.length, 7);
    assert.equal(app.reportNotes.value.length, 1);
});

