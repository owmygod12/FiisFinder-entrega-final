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
    /**
     * Calcula projeção de proventos e retorno sobre patrimônio investido.
     * Suporta cotas de FIIs, ações e ETFs.
     * @param {Object} params
     * @param {number|string} params.price - Cotação atual do ativo.
     * @param {number|string} params.yieldAnnualPercent - Dividend Yield anual em porcentagem (ex: 12 para 12%).
     * @param {number|string} params.quantity - Quantidade de cotas ou ações.
     * @returns {{ totalInvested: number, monthlyYield: number, annualYield: number }}
     */
    function estimateDividends(params = {}) {
        const { price, yieldAnnualPercent, quantity } = params && typeof params === 'object' ? params : {};
        const p = Number(price);
        const y = Number(yieldAnnualPercent);
        const q = Number(quantity);

        if (
            !Number.isFinite(p) ||
            !Number.isFinite(y) ||
            !Number.isFinite(q) ||
            p <= 0 ||
            q <= 0 ||
            y < 0
        ) {
            return { totalInvested: 0, monthlyYield: 0, annualYield: 0 };
        }

        const totalInvested = Number((p * q).toFixed(2));
        const annualYield = Number((totalInvested * (y / 100)).toFixed(2));
        const monthlyYield = Number((annualYield / 12).toFixed(2));

        return { totalInvested, monthlyYield, annualYield };
    }
    function parseNumericInput(value) {
        if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
        if (typeof value === 'string' && value.trim() !== '') {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : NaN;
        }
        return NaN;
    }
    /**
     * Calcula projeção de juros compostos com aporte inicial e aportes mensais recorrentes.
     * Utiliza taxa nominal mensal: i_mensal = (annualRatePercent / 100) / 12.
     * @param {Object} params
     * @param {number|string} params.initialAmount - Capital inicial investido (R$).
     * @param {number|string} params.monthlyContribution - Aporte mensal recorrente (R$).
     * @param {number|string} params.annualRatePercent - Taxa de juros nominal anual em porcentagem (ex: 12 para 12%).
     * @param {number|string} params.months - Prazo total da aplicação em meses.
     * @returns {{ totalInvested: number, totalInterest: number, finalBalance: number }}
     */
    function calculateCompoundInterest(params = {}) {
        const { initialAmount, monthlyContribution, annualRatePercent, months } =
            params && typeof params === 'object' ? params : {};
        const p = parseNumericInput(initialAmount);
        const pmt = parseNumericInput(monthlyContribution);
        const rate = parseNumericInput(annualRatePercent);
        const t = parseNumericInput(months);

        if (
            !Number.isFinite(p) ||
            !Number.isFinite(pmt) ||
            !Number.isFinite(rate) ||
            !Number.isFinite(t) ||
            p < 0 ||
            pmt < 0 ||
            rate < 0 ||
            t <= 0 ||
            (p === 0 && pmt === 0)
        ) {
            return { totalInvested: 0, totalInterest: 0, finalBalance: 0 };
        }

        const monthlyRate = (rate / 100) / 12;
        const rawInvested = p + pmt * t;
        let rawFinalBalance;

        if (monthlyRate === 0) {
            rawFinalBalance = rawInvested;
        } else {
            const factor = Math.pow(1 + monthlyRate, t);
            rawFinalBalance = p * factor + pmt * ((factor - 1) / monthlyRate);
        }

        const totalInvested = Number(rawInvested.toFixed(2));
        const finalBalance = Number(rawFinalBalance.toFixed(2));
        const totalInterest = Number((finalBalance - totalInvested).toFixed(2));

        return { totalInvested, totalInterest, finalBalance };
    }
    /**
     * Simula mês a mês o reinvestimento de proventos ("efeito bola de neve") somado a aportes mensais.
     * @param {Object} params
     * @param {number|string} params.initialShares - Quantidade inicial de cotas ou ações.
     * @param {number|string} params.sharePrice - Preço unitário da cota ou ação (R$).
     * @param {number|string} params.monthlyDividendPerShare - Provento mensal pago por cota/ação (R$).
     * @param {number|string} params.monthlyContribution - Aporte mensal adicional do investidor (R$).
     * @param {number|string} params.months - Prazo da simulação em meses.
     * @returns {{ totalShares: number, totalInvested: number, totalDividendsReceived: number, finalEquity: number, estimatedMonthlyDividend: number }}
     */
    function simulateDividendReinvestment(params = {}) {
        const { initialShares, sharePrice, monthlyDividendPerShare, monthlyContribution, months } =
            params && typeof params === 'object' ? params : {};
        const initShares = parseNumericInput(initialShares);
        const price = parseNumericInput(sharePrice);
        const dividendPerShare = parseNumericInput(monthlyDividendPerShare);
        const contribution = parseNumericInput(monthlyContribution);
        const rawMonths = parseNumericInput(months);
        const totalMonths = Number.isFinite(rawMonths) ? Math.floor(rawMonths) : NaN;

        if (
            !Number.isFinite(initShares) ||
            !Number.isFinite(price) ||
            !Number.isFinite(dividendPerShare) ||
            !Number.isFinite(contribution) ||
            !Number.isFinite(totalMonths) ||
            initShares < 0 ||
            price <= 0 ||
            dividendPerShare < 0 ||
            contribution < 0 ||
            totalMonths <= 0 ||
            (initShares === 0 && contribution === 0)
        ) {
            return {
                totalShares: 0,
                totalInvested: 0,
                totalDividendsReceived: 0,
                finalEquity: 0,
                estimatedMonthlyDividend: 0
            };
        }

        let currentShares = initShares;
        let cashBalance = 0;
        let accumulatedDividends = 0;

        for (let month = 0; month < totalMonths; month++) {
            const dividendsReceived = currentShares * dividendPerShare;
            accumulatedDividends += dividendsReceived;
            const availableCash = Number((cashBalance + dividendsReceived + contribution).toFixed(8));
            const newShares = Math.floor((availableCash + 1e-9) / price);
            cashBalance = Math.max(0, Number((availableCash - newShares * price).toFixed(8)));
            currentShares += newShares;
        }

        const totalShares = Number(currentShares.toFixed(2));
        const totalInvested = Number((initShares * price + contribution * totalMonths).toFixed(2));
        const totalDividendsReceived = Number(accumulatedDividends.toFixed(2));
        const finalEquity = Number((currentShares * price + cashBalance).toFixed(2));
        const estimatedMonthlyDividend = Number((currentShares * dividendPerShare).toFixed(2));

        return {
            totalShares,
            totalInvested,
            totalDividendsReceived,
            finalEquity,
            estimatedMonthlyDividend
        };
    }
    const api = { assetType, validFavorite, normalize, isTicker, finite, assets, search, rank, history, isFii, periodParams, chartData, estimateDividends, calculateCompoundInterest, simulateDividendReinvestment };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.MarketCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
