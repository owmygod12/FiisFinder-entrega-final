'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { isTicker } = require('./market-core.js');
const { MarketService, BrapiProvider } = require('./market-service.cjs');
const files = { '/favorites-store.js': ['favorites-store.js', 'text/javascript'], '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'],
    '/style.css': ['style.css', 'text/css'], '/script.js': ['script.js', 'text/javascript'],
    '/config.js': ['config.js', 'text/javascript'], '/market.js': ['market.js', 'text/javascript'], '/market-core.js': ['market-core.js', 'text/javascript'] };
const ranges = new Set(['1d', '5d', '1mo', '6mo', '1y']);
const intervals = new Set(['5m', '30m', '1d']);
function targetFor(url) {
    const suffix = url.pathname.slice('/api/market/'.length);
    const target = new URL('https://brapi.dev/api/quote/list');
    if (suffix === 'list') {
        const allowed = { search: value => value.length > 0 && value.length <= 100,
            limit: value => ['30', '50'].includes(value), page: value => value === '1', type: value => value === 'stock',
            sortBy: value => value === 'volume', sortOrder: value => value === 'desc' };
        for (const [key, value] of url.searchParams) {
            if (!allowed[key]?.(value)) return null;
            target.searchParams.set(key, value);
        }
    } else if (suffix.startsWith('quote/')) {
        let ticker;
        try { ticker = decodeURIComponent(suffix.slice(6)); } catch { return null; }
        if (!isTicker(ticker) || ticker !== ticker.toUpperCase()) return null;
        target.pathname = `/api/quote/${encodeURIComponent(ticker)}`;
        for (const [key, value] of url.searchParams) {
            if (!((key === 'range' && ranges.has(value)) || (key === 'interval' && intervals.has(value)))) return null;
            target.searchParams.set(key, value);
        }
        if (url.searchParams.has('range') !== url.searchParams.has('interval')) return null;
    } else return null;
    return target;
}
function createServer({ token = process.env.BRAPI_TOKEN, fetchImpl = fetch, now = Date.now } = {}) {
    const provider = new BrapiProvider({ token, fetchImpl, now });
    const service = new MarketService({ providers: [provider], now });
    return http.createServer(async (req, res) => {
        const send = (status, body, type = 'application/json', extra = {}) => {
            res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...extra });
            res.end(body);
        };
        if (req.method !== 'GET') { send(405, '{"error":"method"}', 'application/json', { Allow: 'GET' }); return; }
        let url;
        try { url = new URL(req.url, 'http://localhost'); } catch { send(400, '{}'); return; }
        if (url.pathname === '/healthz' || url.pathname === '/api/market/health') {
            send(200, JSON.stringify({ status: 'ok', service: 'fiisfinder-api', provider: 'Brapi', authConfigured: Boolean(provider.token), alternativeConfigured: false }));
            return;
        }
        if (url.pathname.startsWith('/api/market/')) {
            const target = targetFor(url);
            if (!target) { send(400, '{"error":"invalid_query"}'); return; }
            const result = await service.execute(target);
            send(result.status, result.body, 'application/json', result.retry ? { 'Retry-After': String(result.retry) } : {});
            return;
        }
        const file = files[url.pathname];
        if (!file) { send(404, '{}'); return; }
        try { send(200, await fs.readFile(path.join(__dirname, file[0])), file[1]); }
        catch { send(500, '{}'); }
    });
}
module.exports = { createServer, targetFor };
if (require.main === module) {
    const envPath = path.join(__dirname, '.env');
    if (require('node:fs').existsSync(envPath)) process.loadEnvFile(envPath);
    const port = Number(process.env.PORT) || 8080;
    const server = createServer();
    server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'Porta ocupada. Escolha outra PORT ou verifique o processo existente.' : 'Não foi possível iniciar o servidor.'); process.exitCode = 1; });
    server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`FIIsFinder disponível na porta ${port}; autenticação Brapi ${process.env.BRAPI_TOKEN?.trim() ? 'configurada' : 'ausente'}.`));
}
