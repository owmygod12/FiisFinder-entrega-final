'use strict';
const Core = require('./market-core.js');
const messages = {
    AUTH_MISSING: 'A Brapi exige autenticação para este ativo. Configure BRAPI_TOKEN no .env do servidor e reinicie a API.',
    AUTH_INVALID: 'A Brapi recusou a credencial. Verifique BRAPI_TOKEN no servidor e reinicie a API.',
    ACCESS_DENIED: 'A Brapi negou o acesso (403). A resposta não confirma restrição de plano; verifique permissões da chave e bloqueios do provedor.',
    PLAN_RESTRICTED: 'A Brapi informou uma restrição de assinatura para este recurso.',
    BAD_REQUEST: 'A Brapi não aceitou o ticker, período ou intervalo solicitado.',
    NOT_FOUND: 'Ativo não encontrado na fonte de mercado.',
    RATE_LIMIT: 'Limite de consultas atingido. Aguarde o prazo informado antes de tentar novamente.',
    UPSTREAM_ERROR: 'A fonte de mercado apresentou uma falha temporária. Tente novamente mais tarde.',
    NETWORK_ERROR: 'Não foi possível conectar o servidor à fonte de mercado. Verifique a rede.',
    TIMEOUT: 'A fonte de mercado demorou para responder. Tente novamente mais tarde.',
    INVALID_RESPONSE: 'A fonte de mercado retornou dados inválidos.',
    NO_HISTORY: 'A fonte não retornou histórico para este ativo, período e intervalo.',
    NO_QUOTE: 'A fonte não retornou uma cotação válida para este ticker.',
    BUSY: 'O servidor está ocupado. Aguarde antes de consultar novamente.'
};
function failure(status, code, retry) {
    return { status, retry, data: { error: true, code, message: messages[code] || messages.UPSTREAM_ERROR } };
}
function classify(status, data) {
    const code = String(data?.code || data?.error?.code || '').toUpperCase();
    const text = String(data?.message || data?.error?.message || '');
    if (code === 'MISSING_TOKEN') return 'AUTH_MISSING';
    if (['INVALID_TOKEN', 'EXPIRED_TOKEN', 'UNAUTHORIZED'].includes(code)) return 'AUTH_INVALID';
    // Não inferir assinatura a partir do status 403 ou da palavra "plano" isolada.
    if (['PLAN_REQUIRED', 'PLAN_LIMIT_EXCEEDED', 'SUBSCRIPTION_REQUIRED', 'FEATURE_NOT_IN_PLAN', 'PLAN_RESTRICTED'].includes(code) ||
        /(?:requer|requires|somente|only available|not available|não disponível).{0,30}(?:plano|plan|subscription)|(?:plano|plan).{0,30}(?:não permite|does not (?:include|allow))/i.test(text)) return 'PLAN_RESTRICTED';
    return ({ 400: 'BAD_REQUEST', 401: 'AUTH_INVALID', 403: 'ACCESS_DENIED', 404: 'NOT_FOUND', 429: 'RATE_LIMIT' })[status] || 'UPSTREAM_ERROR';
}
function retrySeconds(value, now) {
    const number = Number(value);
    if (value && Number.isFinite(number) && number >= 0) return Math.max(1, Math.ceil(number));
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(1, Math.ceil((date - now) / 1000)) : 60;
}
class BrapiProvider {
    constructor({ token = process.env.BRAPI_TOKEN, fetchImpl = fetch, now = Date.now } = {}) {
        this.name = 'Brapi'; this.token = String(token || '').trim(); this.fetchImpl = fetchImpl; this.now = now;
        this.blockedUntil = 0;
    }
    supports() { return true; }
    async request(target) {
        if (this.blockedUntil > this.now()) return failure(429, 'RATE_LIMIT', Math.ceil((this.blockedUntil - this.now()) / 1000));
        let response;
        try {
            response = await this.fetchImpl(target, { headers: this.token ? { Authorization: `Bearer ${this.token}` } : {}, signal: AbortSignal.timeout(15000) });
        } catch (error) { return failure(502, ['TimeoutError', 'AbortError'].includes(error.name) ? 'TIMEOUT' : 'NETWORK_ERROR'); }
        let data;
        try { data = await response.json(); } catch { if (response.ok) return failure(502, 'INVALID_RESPONSE'); }
        if (!response.ok || data?.error) {
            const status = response.ok ? 502 : response.status;
            let code = classify(status, data);
            if (response.status === 401 && !this.token) code = 'AUTH_MISSING';
            const retry = response.status === 429 ? retrySeconds(response.headers.get('Retry-After'), this.now()) : undefined;
            if (retry) this.blockedUntil = this.now() + retry * 1000;
            return failure(status, code, retry);
        }
        if (!data || typeof data !== 'object') return failure(502, 'INVALID_RESPONSE');
        return { status: 200, data };
    }
}
function validate(target, result) {
    if (result.status !== 200) return result;
    const data = result.data;
    if (target.pathname.endsWith('/list')) return data && Array.isArray(data.stocks) ? result : failure(502, 'INVALID_RESPONSE');
    const ticker = decodeURIComponent(target.pathname.split('/').at(-1));
    const quote = Array.isArray(data?.results) && data.results.find(item => item?.symbol === ticker);
    if (!quote) return failure(404, 'NO_QUOTE');
    if (target.searchParams.has('range')) {
        if (!Core.history(quote.historicalDataPrice).length) return failure(404, 'NO_HISTORY');
    } else if (!Core.finite(quote.regularMarketPrice) || quote.regularMarketPrice <= 0) return failure(404, 'NO_QUOTE');
    return result;
}
class MarketService {
    constructor({ providers = [new BrapiProvider()], now = Date.now } = {}) {
        this.providers = providers; this.now = now; this.cache = new Map(); this.pending = new Map(); this.queue = Promise.resolve(); this.waiting = 0;
    }
    async execute(target) {
        const key = target.href, cached = this.cache.get(key);
        if (cached?.expires > this.now()) return cached.result;
        if (this.pending.has(key)) return this.pending.get(key);
        if (this.waiting >= 30) return { status: 503, body: JSON.stringify(failure(503, 'BUSY').data) };
        this.waiting++;
        const task = this.queue.then(async () => {
            let result = failure(503, 'UPSTREAM_ERROR'), source;
            for (const [index, provider] of this.providers.entries()) {
                if (!provider.supports(target)) continue;
                try { result = validate(target, await provider.request(target)); }
                catch { result = failure(502, 'UPSTREAM_ERROR'); }
                source = { provider: provider.name, fallback: index > 0 };
                if (result.status === 200 || result.data.code === 'BAD_REQUEST') break;
            }
            // Nunca repassar corpo de erro arbitrário ou segredos do provedor ao navegador.
            if (result.status !== 200) result = failure(result.status, messages[result.data?.code] ? result.data.code : 'UPSTREAM_ERROR', result.retry);
            const output = { status: result.status, retry: result.retry, body: JSON.stringify({ ...result.data, _market: source }) };
            const ttl = result.status === 200 ? (target.pathname.endsWith('/list') ? 300000 : 60000) : result.retry ? result.retry * 1000 : 15000;
            if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value);
            this.cache.set(key, { result: output, expires: this.now() + ttl });
            return output;
        });
        this.queue = task.catch(() => {}); this.pending.set(key, task);
        try { return await task; } finally { this.pending.delete(key); this.waiting--; }
    }
}
module.exports = { BrapiProvider, MarketService, classify, retrySeconds, validate };
