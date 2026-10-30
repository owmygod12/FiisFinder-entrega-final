(function (root) {
    'use strict';
    const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const isTicker = value => /^(?:[A-Z]{4}\d{1,2}|\^[A-Z]{2,12}|[A-Z]{2,12}\.SA)$/.test(String(value).trim().toUpperCase());
    const finite = value => typeof value === 'number' && Number.isFinite(value);
    function assets(data) {
        return [...(Array.isArray(data?.stocks) ? data.stocks : []),
            ...(Array.isArray(data?.indexes) ? data.indexes.map(item => ({ ...item, type: 'index' })) : [])]
            .filter(item => item && isTicker(item.stock))
            .map(item => ({ ...item, ticker: item.stock.toUpperCase(), name: String(item.name || item.stock) }));
    }
    function search(list, query) {
        const q = normalize(query);
        if (!q) return [];
        return list.filter(item => normalize(item.name).includes(q) || normalize(item.ticker).includes(q))
            .sort((a, b) => Number(normalize(b.ticker) === q) - Number(normalize(a.ticker) === q));
    }
    function rank(list, limit = 5) {
        const unique = [...new Map((Array.isArray(list) ? list : []).filter(item => item &&
            isTicker(item.ticker) && finite(item.change) && finite(item.close) && item.close > 0)
            .map(item => [item.ticker, item])).values()];
        return {
            valid: unique.length,
            gainers: unique.filter(item => item.change > 0).sort((a, b) => b.change - a.change || a.ticker.localeCompare(b.ticker)).slice(0, limit),
            losers: unique.filter(item => item.change < 0).sort((a, b) => a.change - b.change || a.ticker.localeCompare(b.ticker)).slice(0, limit)
        };
    }
    function history(rows) {
        return [...new Map((Array.isArray(rows) ? rows : []).filter(item => item && finite(item.date) &&
            item.date > 0 && Number.isFinite(new Date(item.date * 1000).getTime()) && finite(item.close) && item.close > 0)
            .map(item => [item.date, { date: item.date, close: item.close }])).values()].sort((a, b) => a.date - b.date);
    }
    const periods = Object.freeze({ '1d': '5m', '5d': '30m', '1mo': '1d', '6mo': '1d', '1y': '1d' });
    function periodParams(range) {
        if (!Object.hasOwn(periods, range)) throw new Error('Período inválido.');
        return { range, interval: periods[range] };
    }
    function chartData(rows, interval) {
        const points = history(rows);
        const intraday = !['1d', '5d', '1wk', '1mo', '3mo'].includes(interval);
        const formatter = new Intl.DateTimeFormat('pt-BR', intraday
            ? { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }
            : { dateStyle: 'short', timeZone: 'UTC' });
        return { points, labels: points.map(item => formatter.format(new Date(item.date * 1000))), values: points.map(item => item.close) };
    }
    const isFii = asset => Boolean(asset && asset.subType === 'fii' && /^[A-Z]{4}11$/.test(asset.ticker));
    function assetType(asset) {
        if (!asset || !/^[A-Z]{4}\d{1,2}$/.test(asset.ticker) || asset.type === 'index') return null;
        return ({ stock: 'acao', unit: 'unit', fii: 'fii', etf: 'etf' })[asset.subType] || null;
    }
    function validFavorite(asset) {
        return Boolean(assetType(asset) && finite(asset.preco) && asset.preco > 0 &&
            typeof asset.nome === 'string' && asset.nome.trim() && Number.isFinite(Date.parse(asset.atualizado_em)));
    }
    const api = { assetType, validFavorite, normalize, isTicker, finite, assets, search, rank, history, isFii, periodParams, chartData };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.MarketCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
