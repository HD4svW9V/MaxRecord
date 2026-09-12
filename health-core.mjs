export const round1 = n => Math.round(n * 10) / 10;
export function grams(value, label, optional = false) {
  if ((value === '' || value == null) && optional) return '';
  const text = String(value ?? '').trim().replace(/[０-９．]/g, c => String.fromCharCode(c.charCodeAt(0)-0xfee0));
  if (!/^\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(Number(text))) throw Error(`${label}は0以上の数値を入力してください。`);
  return round1(Number(text));
}
export function prepareFood(input) {
  const d = { ...input };
  if (d.type !== 'ドライ') { d.grams = grams(d.grams, '食べた量', true); delete d.dryAction; delete d.targetServeLogId; return d; }
  if (d.dryAction === 'legacy') { delete d.dryAction; return d; }
  if (!['serve','discard','instant'].includes(d.dryAction)) throw Error('記録方法を選択してください。');
  d.serveGrams = grams(d.serveGrams, '配膳量');
  if (d.serveGrams <= 0) throw Error('配膳量は0より大きい数値を入力してください。');
  if (d.dryAction !== 'serve') {
    d.discardGrams = grams(d.discardGrams, '廃棄量');
    if (d.discardGrams > d.serveGrams) throw Error('廃棄量が配膳量を超えています。');
    d.eatenGrams = round1(d.serveGrams - d.discardGrams);
  }
  return d;
}
export const dateOf = ts => String(ts || '').slice(0,10);
export const isPee = type => ['おしっこ', '尿', '両方'].includes(type);
export const isPoop = type => ['うんち', 'うんこ', '便', '両方'].includes(type);
export function daily(logs, date) {
  const day = logs.filter(l => dateOf(l.timestamp) === date);
  const dry = logs.filter(l => l.category === 'food' && l.details?.type === 'ドライ' && l.details?.dryAction !== 'serve' && (l.details?.effectiveDate || dateOf(l.timestamp)) === date);
  const measured = dry.filter(l => typeof l.details?.eatenGrams === 'number');
  return { date, dry: measured.length ? round1(measured.reduce((s,l)=>s+l.details.eatenGrams,0)) : null,
    legacy: dry.filter(l => !l.details?.dryAction).length,
    water: day.filter(l => l.category === 'water').length,
    pee: day.filter(l => l.category === 'toilet' && isPee(l.details?.type)).length,
    poop: day.filter(l => l.category === 'toilet' && isPoop(l.details?.type)).length,
    symptom: day.filter(l=>l.category==='symptom').length,
    fluid: day.some(l=>l.category==='fluid' && l.details?.hasFluid),
    stimulant: day.some(l=>l.category==='fluid' && l.details?.hasAppetiteStimulant) };
}
