const compact = value => String(value || '').normalize('NFKC').replace(/[、,。]/g, ' ').replace(/\s+/g, ' ').trim();

const amountOf = (text, units) => {
  const unitPattern = units.map(unit => unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:${unitPattern})(?!円)`,'i'));
  return match ? Number(match[1]) : null;
};

const labeled = (text, labels) => {
  const allLabels = '(?:お?皿|器|商品|フード|メモ|備考|値段|価格)';
  const labelPattern = `(?:${labels.join('|')})`;
  const match = text.match(new RegExp(`(?:^|\\s)${labelPattern}(?:は|が|:|：)?\\s*(.+?)(?=\\s+${allLabels}(?:は|が|:|：)?|$)`));
  return match?.[1]?.trim() || '';
};

const conditionOf = text => {
  const aliases = [
    ['普通', /普通|いつも通り/],
    ['少なめ', /少なめ|少ない/],
    ['多め', /多め|多い/]
  ];
  return aliases.find(([, pattern]) => pattern.test(text))?.[0] || '';
};

const fail = (code, message, missing = []) => ({ ok: false, code, message, missing });

export function parseTaskTitle(rawTitle) {
  const raw = compact(rawTitle);
  const text = raw.replace(/^マックス\s*記録\s*/i, '').trim();
  if (!text) return fail('EMPTY', '記録内容がありません。');

  const dish = labeled(text, ['お?皿', '器']);
  const productName = labeled(text, ['商品', 'フード']);
  const spokenNote = labeled(text, ['メモ', '備考']);
  const base = { rawText: raw, dish, productName, note: spokenNote, inputSource: 'google-tasks' };

  if (/食欲\s*増進剤|ミラタズ/.test(text)) {
    return { ok: true, event: { category: 'fluid', details: { ...base, hasFluid: false, fluidMl: null, hasAppetiteStimulant: true } } };
  }

  if (/補液|皮下\s*(?:輸液|点滴)/.test(text)) {
    const fluidMl = amountOf(text, ['ml', 'mL', 'ミリリットル']) ?? 100;
    if (!(fluidMl > 0 && fluidMl <= 1000)) return fail('INVALID_AMOUNT', '補液量を確認してください。');
    return { ok: true, event: { category: 'fluid', details: { ...base, hasFluid: true, fluidMl, hasAppetiteStimulant: false } } };
  }

  if (/おしっこ|尿/.test(text)) {
    const amount = conditionOf(text);
    if (!amount) return fail('MISSING_CONDITION', 'おしっこの状態（普通・少なめ・多め）がありません。', ['condition']);
    return { ok: true, event: { category: 'toilet', details: { ...base, type: 'おしっこ', amount } } };
  }

  if (/うんち|うんこ|便/.test(text)) {
    const amount = conditionOf(text);
    if (!amount) return fail('MISSING_CONDITION', 'うんちの状態（普通・少なめ・多め）がありません。', ['condition']);
    return { ok: true, event: { category: 'toilet', details: { ...base, type: 'うんち', amount } } };
  }

  const isWater = /飲み水|お水|水/.test(text);
  const foodType = /ウェット|ウエット/.test(text) ? 'ウェット' : /ドライ|カリカリ/.test(text) ? 'ドライ' : '';
  const isServe = /配膳|給水|出した|置いた|あげた|セット/.test(text);
  const isDiscard = /回収|廃棄|片付け|片づけ|下げた/.test(text);
  if (isServe && isDiscard) return fail('AMBIGUOUS_ACTION', '配膳と回収の両方が含まれています。');
  if ((isWater || foodType) && !isServe && !isDiscard) return fail('MISSING_ACTION', '配膳か回収か分かりません。', ['action']);

  if (isWater) {
    const grams = amountOf(text, ['g', 'グラム']);
    if (grams === null) return fail('MISSING_AMOUNT', '水の重さがありません。', ['amount']);
    if (!(grams >= 0 && grams <= 5000)) return fail('INVALID_AMOUNT', '水の重さを確認してください。');
    return { ok: true, event: { category: 'water', action: isServe ? 'serve' : 'discard', amount: grams, details: base } };
  }

  if (foodType) {
    const grams = amountOf(text, ['g', 'グラム']);
    if (grams === null) return fail('MISSING_AMOUNT', 'ごはんの重さがありません。', ['amount']);
    if (!(grams >= 0 && grams <= 5000)) return fail('INVALID_AMOUNT', 'ごはんの重さを確認してください。');
    return { ok: true, event: { category: 'food', action: isServe ? 'serve' : 'discard', amount: grams, foodType, details: base } };
  }

  return fail('UNKNOWN_EVENT', '記録の種類を判定できませんでした。');
}

export function chooseOpenServe(event, logs) {
  const actionKey = event.category === 'food' ? 'dryAction' : 'waterAction';
  const open = logs.filter(log => log.category === event.category && log.details?.[actionKey] === 'serve' && !log.details?.isClosed);
  let candidates = open;
  if (event.category === 'food') candidates = candidates.filter(log => (log.details?.type || 'ドライ') === event.foodType);
  if (event.details.dish) candidates = candidates.filter(log => log.details?.dish === event.details.dish);
  if (event.category === 'food' && event.details.productName) candidates = candidates.filter(log => log.details?.productName === event.details.productName);
  if (candidates.length === 1) return { ok: true, log: candidates[0] };
  if (candidates.length === 0) return fail('SERVE_NOT_FOUND', '対応する未回収の配膳記録がありません。');
  return fail('SERVE_AMBIGUOUS', '候補の皿が複数あります。回収する皿名を付けてください。', ['dish']);
}
