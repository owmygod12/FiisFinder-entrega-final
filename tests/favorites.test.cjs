const {test}=require('node:test');
const assert=require('node:assert/strict');
const {FavoritesStore}=require('../favorites-store.js');
const C=require('../market-core.js');
function store(){const data=new Map();return new FavoritesStore({storage:{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)}});}
const asset=(ticker,subType)=>({ticker,subType,type:subType==='fii'||subType==='etf'?'fund':'stock',nome:ticker,preco:10,variacao:1,atualizado_em:'2026-10-30T18:00:00Z'});
for(const [ticker,subType,tipo] of [['PETR4','stock','acao'],['ITSA4','stock','acao'],['BPAC11','unit','unit'],['MXRF11','fii','fii'],['BOVA11','etf','etf']])test(ticker+' é salvo como '+tipo,async()=>{const s=store();await s.add(asset(ticker,subType));assert.equal((await s.list())[0].tipo_ativo,tipo);});
test('duplicado não é inserido',async()=>{const s=store();await s.add(asset('PETR4','stock'));await assert.rejects(s.add(asset('PETR4','stock')),/já está/);assert.equal((await s.list()).length,1);});
test('índice e categoria desconhecida não são ações',async()=>{const s=store();assert.equal(C.assetType(asset('^BVSP','stock')),null);await assert.rejects(s.add(asset('^BVSP','stock')));await assert.rejects(s.add(asset('PETR4',undefined)));});
test('exclusão preserva outros favoritos',async()=>{const s=store();await s.add(asset('PETR4','stock'));await s.add(asset('MXRF11','fii'));await s.remove('PETR4');assert.deepEqual((await s.list()).map(r=>r.ticker),['MXRF11']);});
test('atualização mantém id e atualiza preço e data',async()=>{const s=store();await s.add(asset('PETR4','stock'));await s.update('PETR4',{...asset('PETR4','stock'),preco:20,atualizado_em:'2026-10-30T19:00:00Z'});const rows=await s.list();assert.equal(rows.length,1);assert.equal(rows[0].preco,20);assert.equal(rows[0].atualizado_em,'2026-10-30T19:00:00Z');});
test('preço inválido e data ausente não são salvos',async()=>{for(const preco of [null,0,-1,NaN,Infinity,'10'])await assert.rejects(store().add({...asset('PETR4','stock'),preco}));await assert.rejects(store().add({...asset('PETR4','stock'),atualizado_em:null}));});
test('operação concorrente bloqueada e lock liberado',async()=>{const s=store();const first=s.add(asset('PETR4','stock'));await assert.rejects(s.add(asset('ITSA4','stock')),/Aguarde/);await first;assert.equal(s.busy,false);});
test('Supabase sem sessão não consulta tabela',async()=>{const s=new FavoritesStore({client:{from(){throw Error('não acessar')}}});await assert.rejects(s.list(),/Conecte/);});
