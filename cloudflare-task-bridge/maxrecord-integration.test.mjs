import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('MaxRecordは補液量100mlを保存・編集・表示できる', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /fluid: \{ hasFluid: true, fluidMl: 100,/);
  assert.match(html, /details\.fluidMl = grams\(details\.fluidMl \?\? 100, '補液量'\)/);
  assert.match(html, /v-model="form\.fluid\.fluidMl"/);
  assert.match(html, /log\.details\?\.fluidMl \?\? 100/);
});
