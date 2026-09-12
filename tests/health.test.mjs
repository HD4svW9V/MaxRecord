import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {prepareFood,round1,daily,grams} from '../health-core.mjs';
const food = {type:'ドライ',dryAction:'instant',serveGrams:'３．２',discardGrams:'0.5'};
test('decimal, full width and invalid amounts',()=>{
 assert.equal(prepareFood(food).eatenGrams,2.7);
 for(const n of ['',-1,'Infinity','3abc']) assert.throws(()=>prepareFood({...food,serveGrams:n}));
 assert.throws(()=>prepareFood({...food,discardGrams:4}));
 assert.equal(prepareFood({...food,discardGrams:0}).eatenGrams,3.2);
});
test('discard date and legacy toilet/food data remain meaningful',()=>{
 const logs=[{category:'food',timestamp:'2026-09-11T23:00',details:{type:'ドライ',dryAction:'serve',serveGrams:3}},
 {category:'food',timestamp:'2026-09-12T08:00',details:{type:'ドライ',dryAction:'discard',effectiveDate:'2026-09-12',eatenGrams:2}},
 {category:'food',timestamp:'2026-09-12T09:00',details:{type:'ドライ',amount:'普通'}},
 ...['うんこ','うんち','両方'].map(type=>({category:'toilet',timestamp:'2026-09-12T10:00',details:{type}}))];
 assert.equal(daily(logs,'2026-09-11').dry,null);
 assert.deepEqual([daily(logs,'2026-09-12').dry,daily(logs,'2026-09-12').legacy,daily(logs,'2026-09-12').pee,daily(logs,'2026-09-12').poop],[2,1,1,3]);
});
function harness(){
 let app, counter=0; const data=new Map(), alerts=[];
 const col={};
 const ctx={prepareFood,round1,daily,grams,console,Date,setInterval:()=>{},alert:m=>alerts.push(m),confirm:()=>true,
 ref:v=>({value:v}),computed:f=>({get value(){return f()}}),watch:()=>{},nextTick:async()=>{},onMounted:()=>{},
 createApp:obj=>({mount(){app=obj.setup()}}),initializeApp:()=>({}),getAuth:()=>({}),getFirestore:()=>({}),Chart:{register(){}},ChartDataLabels:{},
 collection:()=>col,doc:(c,id)=>({id:id||`test-${++counter}`}),runTransaction:async(db,f)=>{
  const pending=[]; await f({get:async r=>({exists:()=>data.has(r.id),data:()=>structuredClone(data.get(r.id))}),set:(r,v)=>pending.push(()=>data.set(r.id,v)),update:(r,v)=>pending.push(()=>{const l=data.get(r.id);for(const [k,val] of Object.entries(v)){if(k.startsWith('details.'))l.details[k.slice(8)]=val;else l[k]=val;}}),delete:r=>pending.push(()=>data.delete(r.id))});
  pending.forEach(f=>f()); app.logs.value=[...data].map(([id,l])=>({id,...structuredClone(l)}));
 }};
 let src=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8').match(/<script type="module">([\s\S]*?)<\/script>/)[1];
 src=src.replace(/^\s*import .*?;$/gm,'');
 // Expose only authentication state needed by the persistence harness.
 src=src.replace('syncError, syncedAt, filterCategory','currentUser, syncError, syncedAt, filterCategory');
 vm.runInNewContext(src,ctx);
 app.currentUser.value={uid:'test'};app.isOnline.value=true;
 return {app,data,alerts};
}
test('atomic serving lifecycle: save, no double discard, edit, reopen on delete',async()=>{
 const {app:a,data,alerts}=harness();
 a.openModal('food');a.form.value.food.serveGrams='3.2';a.form.value.timestamp='2026-09-11T23:00';await a.saveLog();
 assert.equal(data.size,1);const serve=a.logs.value[0];
 a.openDiscardModal(serve);a.form.value.timestamp='2026-09-12T08:00';a.form.value.food.discardGrams='0.5';await a.saveLog();
 assert.equal(data.size,2);assert.equal(data.get(serve.id).details.isClosed,true);
 const discard=a.logs.value.find(l=>l.details.dryAction==='discard');assert.equal(discard.details.eatenGrams,2.7);
 a.openDiscardModal(serve);a.form.value.timestamp='2026-09-12T09:00';a.form.value.food.discardGrams='0';await a.saveLog();assert.equal(data.size,2);assert.match(alerts.at(-1),/回収済/);
 a.openEditModal(discard);a.form.value.food.discardGrams='1.2';await a.saveLog();assert.equal(data.get(discard.id).details.eatenGrams,2);
 await a.deleteLog(serve.id);assert.equal(data.size,2);
 await a.deleteLog(discard.id);assert.equal(data.size,1);assert.equal(data.get(serve.id).details.isClosed,false);
});
test('legacy edit preserves old type and amount; offline never fakes a save',async()=>{
 const {app:a,data,alerts}=harness();
 const old={category:'food',title:'ごはん',timestamp:'2026-09-11T09:00',details:{type:'ドライ',amount:'少なめ',note:'旧記録'}};data.set('old',old);
 a.openEditModal({id:'old',...old});await a.saveLog();assert.equal(data.get('old').details.amount,'少なめ');assert.equal(data.get('old').details.eatenGrams,undefined);
 a.openModal('notice');a.form.value.notice.description='残す';a.isOnline.value=false;await a.saveLog();assert.equal(data.size,1);assert.equal(a.form.value.notice.description,'残す');assert.match(alerts.at(-1),/接続/);
});
