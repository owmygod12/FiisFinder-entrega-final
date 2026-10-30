const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const C = require('../market-core.js');
const { createServer, targetFor } = require('../server.cjs');

test('normalização e busca por nome, ticker e classes', () => {
    const items = C.assets({ stocks: [{ stock: 'ITUB3', name: 'Itaú ON' }, { stock: 'ITUB4', name: 'Itaú PN' }], indexes: [{ stock: '^BVSP', name: 'Ibovespa' }] });
    assert.equal(C.normalize('  ITAÚ '), 'itau');
    assert.deepEqual(C.search(items, 'itau').map(x => x.ticker), ['ITUB3', 'ITUB4']);
    assert.equal(C.search(items, 'itub4')[0].ticker, 'ITUB4');
    assert.equal(C.search(items, 'ibovespa')[0].ticker, '^BVSP');
    for (const value of ['ITUB3', 'ITUB4', 'VALE3', 'MXRF11', 'KNCR11', '^BVSP']) assert.ok(C.isTicker(value));
    for (const value of ['Itaú', 'Petrobras', '<script>', '', 'PETR4/../../']) assert.ok(!C.isTicker(value));
});
test('ranking separa altas e quedas e elimina valores inválidos', () => {
    const rows = [{ ticker: 'ITUB4', close: 30, change: 2 }, { ticker: 'VALE3', close: 60, change: -3 },
        { ticker: 'PETR4', close: 40, change: 5 }, { ticker: 'MGLU3', close: 10, change: 0 },
        { ticker: 'ABCD3', close: 10, change: null }, { ticker: 'EFGH3', close: 0, change: 8 },
        { ticker: 'IJKL3', close: 10, change: NaN }, { ticker: 'MNOP3', close: 10, change: '5' }];
    const ranked = C.rank(rows);
    assert.deepEqual(ranked.gainers.map(x => x.ticker), ['PETR4', 'ITUB4']);
    assert.deepEqual(ranked.losers.map(x => x.ticker), ['VALE3']);
    assert.equal(ranked.valid, 4);
});
test('dados vazios, histórico inválido e distinção FII/unit/índice', () => {
    assert.deepEqual(C.assets(null), []); assert.deepEqual(C.search([], ''), []);
    assert.deepEqual(C.rank(null), { valid: 0, gainers: [], losers: [] });
    assert.deepEqual(C.history([null, { date: 1, close: null }, { date: 2, close: Infinity }]), []);
    assert.deepEqual(C.history([{ date: 3, close: 12 }, { date: 1, close: 10 }, { date: 3, close: 13 }]), [{ date: 1, close: 10 }, { date: 3, close: 13 }]);
    assert.ok(C.isFii({ ticker: 'MXRF11', subType: 'fii' }));
    for (const asset of [{ ticker: 'BPAC11', subType: 'unit' }, { ticker: '^BVSP', subType: 'fii' }, { ticker: 'MXRF11' }]) assert.ok(!C.isFii(asset));
});
test('HTML não duplica IDs nem limita busca a seis caracteres', () => {
    const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(x => x[1]);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.filter(id => id === 'search-btn').length, 1);
    assert.ok(!/maxlength="6"|Mínimo de 6/.test(html));
});
test('proxy rejeita nomes, endpoints arbitrários e tokens do navegador', () => {
    for (const value of ['quote/Petrobras', 'quote/PETR4?token=secret', 'list?url=https://example.com', 'quote/PETR4?range=max']) {
        assert.equal(targetFor(new URL(`http://local/api/market/${value}`)), null);
    }
    assert.ok(targetFor(new URL('http://local/api/market/quote/%5EBVSP?range=1mo&interval=1d')));
});
test('proxy usa token no servidor, cache, serialização e protege arquivos privados', async t => {
    let calls = 0, concurrent = 0, maxConcurrent = 0;
    const server = createServer({ token: 'test-private-token', fetchImpl: async (url, options) => {
        assert.equal(options.headers.Authorization, 'Bearer test-private-token');
        assert.ok(!url.href.includes('test-private-token'));
        calls++; concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise(resolve => setTimeout(resolve, 10)); concurrent--;
        return new Response(JSON.stringify({ results: [{ symbol: decodeURIComponent(url.pathname.split('/').at(-1)), regularMarketPrice: 40 }] }));
    } });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const responses = await Promise.all(['/api/market/quote/PETR4', '/api/market/quote/PETR4', '/api/market/quote/ITUB4'].map(url => fetch(base + url)));
    assert.ok(responses.every(x => x.status === 200)); assert.equal(calls, 2); assert.equal(maxConcurrent, 1);
    assert.ok(!(await responses[0].text()).includes('test-private-token'));
    await fetch(base + '/api/market/quote/PETR4'); assert.equal(calls, 2);
    for (const file of ['/.env', '/server.cjs', '/.git/config']) assert.equal((await fetch(base + file)).status, 404);
});
test('proxy trata 429 sem nova chamada durante Retry-After e não devolve erro privado', async t => {
    let calls = 0;
    const server = createServer({ fetchImpl: async () => { calls++; return new Response('secret-provider-error', { status: 429, headers: { 'Retry-After': '5' } }); } });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const base = `http://127.0.0.1:${server.address().port}/api/market/quote/`;
    const first = await fetch(base + 'PETR4'); assert.equal(first.status, 429); assert.equal(first.headers.get('Retry-After'), '5');
    assert.ok(!(await first.text()).includes('secret-provider-error'));
    assert.equal((await fetch(base + 'VALE3')).status, 429); assert.equal(calls, 1);
});
