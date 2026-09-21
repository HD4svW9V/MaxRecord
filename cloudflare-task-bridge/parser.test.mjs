import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskTitle, chooseOpenServe } from './parser.mjs';

test('8種類の基本発話を解析する', () => {
  const cases = [
    ['マックス記録 ドライフードを配膳 200g お皿はことり 商品はコンボプレゼント', 'food', 'serve'],
    ['マックス記録 ウェットフードを回収 120g 皿はことり 商品はコンボプレゼント', 'food', 'discard'],
    ['マックス記録 飲み水を配膳 300g お皿はガラス', 'water', 'serve'],
    ['マックス記録 飲み水を回収 200g 皿はガラス', 'water', 'discard'],
    ['マックス記録 おしっこを記録 普通', 'toilet', undefined],
    ['マックス記録 うんちを記録 普通', 'toilet', undefined],
    ['マックス記録 補液を記録', 'fluid', undefined],
    ['マックス記録 食欲増進剤を記録', 'fluid', undefined]
  ];
  for (const [title, category, action] of cases) {
    const parsed = parseTaskTitle(title); assert.equal(parsed.ok, true, title); assert.equal(parsed.event.category, category); assert.equal(parsed.event.action, action);
  }
});

test('皿・商品と補液既定値を保持する', () => {
  const food = parseTaskTitle('マックス 記録 ドライフード 配膳 200g 皿は小鳥 商品はコンボ プレゼント 値段は1200円');
  assert.equal(food.event.details.dish, '小鳥'); assert.equal(food.event.details.productName, 'コンボ プレゼント');
  assert.equal(parseTaskTitle('マックス記録 補液した').event.details.fluidMl, 100);
  assert.equal(parseTaskTitle('マックス記録 補液 80ml').event.details.fluidMl, 80);
});

test('必須項目不足は登録可能データにしない', () => {
  assert.equal(parseTaskTitle('マックス記録 ドライフードを配膳').code, 'MISSING_AMOUNT');
  assert.equal(parseTaskTitle('マックス記録 おしっこを記録').code, 'MISSING_CONDITION');
});

test('回収対象は皿名で一意に選ぶ', () => {
  const logs = [
    { id: 'a', category: 'food', details: { type: 'ドライ', dryAction: 'serve', dish: 'ことり', productName: 'コンボプレゼント', isClosed: false } },
    { id: 'b', category: 'food', details: { type: 'ドライ', dryAction: 'serve', dish: 'ガラス', productName: 'コンボプレゼント', isClosed: false } }
  ];
  const event = parseTaskTitle('マックス記録 ドライを回収 100g 皿はことり').event;
  assert.equal(chooseOpenServe(event, logs).log.id, 'a');
  delete event.details.dish; assert.equal(chooseOpenServe(event, logs).code, 'SERVE_AMBIGUOUS');
});
