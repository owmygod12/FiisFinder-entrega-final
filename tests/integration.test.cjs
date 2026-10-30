const { test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../market-core.js');
const { BrapiProvider, MarketService, classify, retrySeconds } = require('../market-service.cjs');
const { targetFor, createServer } = require('../server.cjs');
const quoteTarget = ticker => new URL('https://brapi.dev/api/quote/' + encodeURIComponent(ticker));

test('403 genérico não comprova plano; código explícito é distinto', () => {
    assert.equal(classify(403, { message: 'Forbidden' }), 'ACCESS_DENIED');
    assert.equal(classify(403, { message: 'Acesso bloqueado pelo firewall' }), 'ACCESS_DENIED');
    assert.equal(classify(403, { code: 'SUBSCRIPTION_REQUIRED' }), 'PLAN_RESTRICTED');
    assert.equal(classify(401, { code: 'MISSING_TOKEN' }), 'AUTH_MISSING');
});
for (const [status, code] of [[400, 'BAD_REQUEST'], [401, 'AUTH_INVALID'], [403, 'ACCESS_DENIED'], [404, 'NOT_FOUND'], [429, 'RATE_LIMIT'], [500, 'UPSTREAM_ERROR'], [503, 'UPSTREAM_ERROR']]) {
    test(`HTTP ${status} produz código seguro ${code}`, async () => {
        const provider = new BrapiProvider({ token: 'private-test-key', fetchImpl: async () => new Response(JSON.stringify({ message: 'private-test-key' }), { status }) });
        const result = await provider.request(quoteTarget('PETR3'));
        assert.equal(result.status, status); assert.equal(result.data.code, code);
        assert.ok(!JSON.stringify(result).includes('private-test-key'));
    });
}
test('401 sem chave distingue configuração ausente de chave recusada', async () => {
    const provider = new BrapiProvider({ token: '', fetchImpl: async () => new Response('{}', { status: 401 }) });
    assert.equal((await provider.request(quoteTarget('PETR3'))).data.code, 'AUTH_MISSING');
});
test('rede, timeout, JSON inválido e dados vazios são erros distintos', async () => {
    for (const [name, code] of [['TypeError', 'NETWORK_ERROR'], ['TimeoutError', 'TIMEOUT']]) {
        const provider = new BrapiProvider({ fetchImpl: async () => { throw Object.assign(new Error('private'), { name }); } });
        assert.equal((await provider.request(quoteTarget('PETR4'))).data.code, code);
    }
    const service = new MarketService({ providers: [new BrapiProvider({ fetchImpl: async () => new Response('<html>erro privado</html>') })] });
    assert.equal(JSON.parse((await service.execute(quoteTarget('PETR4'))).body).code, 'INVALID_RESPONSE');
    const empty = new MarketService({ providers: [new BrapiProvider({ fetchImpl: async () => Response.json({ results: [] }) })] });
    assert.equal(JSON.parse((await empty.execute(quoteTarget('PETR4'))).body).code, 'NO_QUOTE');
});
test('histórico vazio não retorna sucesso nem cotação artificial', async () => {
    const target = quoteTarget('^BVSP'); target.search = 'range=1mo&interval=1d';
    const service = new MarketService({ providers: [new BrapiProvider({ fetchImpl: async () => Response.json({ results: [{ symbol: '^BVSP', historicalDataPrice: [] }] }) })] });
    const result = await service.execute(target);
    assert.equal(result.status, 404); assert.equal(JSON.parse(result.body).code, 'NO_HISTORY');
});
test('todos os períodos produzem intervalos conhecidos e ^BVSP é codificado uma vez', () => {
    for (const range of ['1d', '5d', '1mo', '6mo', '1y']) {
        const params = Core.periodParams(range);
        const target = targetFor(new URL('http://localhost/api/market/quote/%5EBVSP?' + new URLSearchParams(params)));
        assert.equal(target.pathname, '/api/quote/%5EBVSP'); assert.ok(!target.href.includes('%255E'));
        assert.equal(target.searchParams.get('range'), range);
    }
    assert.throws(() => Core.periodParams('max'));
});
test('conversão Chart.js ordena preços e preserva dia UTC sem retroceder a data', () => {
    const date = Date.parse('2026-10-30T00:00:00Z') / 1000;
    const daily = Core.chartData([{ date, close: 100 }, { date: date - 86400, close: 90 }], '1d');
    assert.deepEqual(daily.labels, ['29/10/2026', '30/10/2026']); assert.deepEqual(daily.values, [90, 100]);
    const intraday = Core.chartData([{ date: date + 15 * 3600, close: 100 }], '5m');
    assert.match(intraday.labels[0], /12:00/);
    assert.deepEqual(Core.chartData(null, '1d').values, []);
});
test('provedor alternativo é usado somente após falha; fonte fica identificada', async () => {
    let alternativeCalls = 0;
    const primary = { name: 'Brapi', supports: () => true, request: async () => ({ status: 404, data: { error: true, code: 'NO_HISTORY' } }) };
    const alternative = { name: 'Alternative-test-only', supports: () => true, request: async () => {
        alternativeCalls++; return { status: 200, data: { results: [{ symbol: 'PETR4', regularMarketPrice: 10 }] } };
    } };
    const service = new MarketService({ providers: [primary, alternative] });
    const result = JSON.parse((await service.execute(quoteTarget('PETR4'))).body);
    assert.equal(result._market.provider, 'Alternative-test-only'); assert.equal(result._market.fallback, true);
    assert.equal(alternativeCalls, 1);
    primary.request = alternative.request;
    const healthy = new MarketService({ providers: [primary, { ...alternative, request() { throw Error('não chamar'); } }] });
    assert.equal(JSON.parse((await healthy.execute(quoteTarget('PETR4'))).body)._market.fallback, false);
});
test('alternativa incompatível não é chamada e erros de consulta não geram fallback', async () => {
    const service = new MarketService({ providers: [
        { name: 'Brapi', supports: () => true, request: async () => ({ status: 400, data: { error: true, code: 'BAD_REQUEST' } }) },
        { name: 'Alternative', supports: () => true, request: () => { throw Error('não chamar'); } }
    ] });
    assert.equal((await service.execute(quoteTarget('PETR4'))).status, 400);
});
test('Retry-After aceita segundos e HTTP-date', () => {
    const now = Date.parse('2026-10-30T12:00:00Z');
    assert.equal(retrySeconds('10', now), 10);
    assert.equal(retrySeconds('Fri, 30 Oct 2026 12:00:30 GMT', now), 30);
});
test('health não expõe segredo nem faz chamadas financeiras', async t => {
    const server = createServer({ token: 'secret-health-test', fetchImpl() { throw Error('não chamar'); } });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/market/health`);
    const body = await response.text(); assert.equal(response.status, 200); assert.ok(!body.includes('secret-health-test'));
    assert.equal(JSON.parse(body).authConfigured, true);
});
