'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const MarketCore = require('../market-core.js');
const { calculateCompoundInterest, simulateDividendReinvestment } = MarketCore;

const ZERO_COMPOUND = Object.freeze({
    totalInvested: 0,
    totalInterest: 0,
    finalBalance: 0
});

const ZERO_REINVEST = Object.freeze({
    totalShares: 0,
    totalInvested: 0,
    totalDividendsReceived: 0,
    finalEquity: 0,
    estimatedMonthlyDividend: 0
});

test('calculateCompoundInterest: cenário padrão (R$ 1.000 inicial, R$ 200/mês, 12% a.a., 12 meses)', () => {
    const result = calculateCompoundInterest({
        initialAmount: 1000,
        monthlyContribution: 200,
        annualRatePercent: 12,
        months: 12
    });

    assert.deepEqual(result, {
        totalInvested: 3400,
        totalInterest: 263.33,
        finalBalance: 3663.33
    });
    assert.ok(result.finalBalance > result.totalInvested);
    assert.equal(Number((result.totalInvested + result.totalInterest).toFixed(2)), result.finalBalance);
});

test('calculateCompoundInterest: cenário sem taxa (0%) preserva capital investido sem juros', () => {
    const result = calculateCompoundInterest({
        initialAmount: 1000,
        monthlyContribution: 200,
        annualRatePercent: 0,
        months: 12
    });

    assert.equal(result.totalInterest, 0);
    assert.equal(result.finalBalance, result.totalInvested);
    assert.equal(result.totalInvested, 3400);
});

test('calculateCompoundInterest: aceita strings numéricas, aporte único ou apenas aportes mensais', () => {
    assert.deepEqual(
        calculateCompoundInterest({
            initialAmount: '1000',
            monthlyContribution: '200',
            annualRatePercent: '12',
            months: '12'
        }),
        { totalInvested: 3400, totalInterest: 263.33, finalBalance: 3663.33 }
    );

    const lumpSum = calculateCompoundInterest({
        initialAmount: 1000,
        monthlyContribution: 0,
        annualRatePercent: 12,
        months: 12
    });
    assert.deepEqual(lumpSum, { totalInvested: 1000, totalInterest: 126.83, finalBalance: 1126.83 });

    const monthlyOnly = calculateCompoundInterest({
        initialAmount: 0,
        monthlyContribution: 200,
        annualRatePercent: 12,
        months: 12
    });
    assert.deepEqual(monthlyOnly, { totalInvested: 2400, totalInterest: 136.5, finalBalance: 2536.5 });
});

test('calculateCompoundInterest: cenário defensivo retorna zeros para entradas zeradas, negativas ou inválidas', () => {
    assert.deepEqual(calculateCompoundInterest(), ZERO_COMPOUND);
    assert.deepEqual(calculateCompoundInterest(undefined), ZERO_COMPOUND);
    assert.deepEqual(calculateCompoundInterest(null), ZERO_COMPOUND);
    assert.deepEqual(calculateCompoundInterest({}), ZERO_COMPOUND);

    const defensiveCases = [
        { initialAmount: 0, monthlyContribution: 0, annualRatePercent: 0, months: 0 },
        { initialAmount: 0, monthlyContribution: 0, annualRatePercent: 12, months: 12 },
        { initialAmount: 1000, monthlyContribution: 200, annualRatePercent: 12, months: 0 },
        { initialAmount: -100, monthlyContribution: 200, annualRatePercent: 12, months: 12 },
        { initialAmount: 1000, monthlyContribution: -50, annualRatePercent: 12, months: 12 },
        { initialAmount: 1000, monthlyContribution: 200, annualRatePercent: -1, months: 12 },
        { initialAmount: 1000, monthlyContribution: 200, annualRatePercent: 12, months: -12 }
    ];

    for (const params of defensiveCases) {
        assert.deepEqual(calculateCompoundInterest(params), ZERO_COMPOUND);
    }

    for (const bad of ['abc', '', '   ', null, undefined, NaN, Infinity, -Infinity, {}, [1]]) {
        assert.deepEqual(
            calculateCompoundInterest({ initialAmount: bad, monthlyContribution: 200, annualRatePercent: 12, months: 12 }),
            ZERO_COMPOUND
        );
        assert.deepEqual(
            calculateCompoundInterest({ initialAmount: 1000, monthlyContribution: bad, annualRatePercent: 12, months: 12 }),
            ZERO_COMPOUND
        );
        assert.deepEqual(
            calculateCompoundInterest({ initialAmount: 1000, monthlyContribution: 200, annualRatePercent: bad, months: 12 }),
            ZERO_COMPOUND
        );
        assert.deepEqual(
            calculateCompoundInterest({ initialAmount: 1000, monthlyContribution: 200, annualRatePercent: 12, months: bad }),
            ZERO_COMPOUND
        );
    }
});

test('simulateDividendReinvestment: cenário padrão supera compras por aporte puro (efeito bola de neve)', () => {
    const result = simulateDividendReinvestment({
        initialShares: 100,
        sharePrice: 10,
        monthlyDividendPerShare: 0.1,
        monthlyContribution: 100,
        months: 12
    });

    const sharesWithoutReinvestment = 100 + Math.floor((100 * 12) / 10);
    assert.equal(sharesWithoutReinvestment, 220);
    assert.ok(result.totalShares > sharesWithoutReinvestment);

    assert.deepEqual(result, {
        totalShares: 239,
        totalInvested: 2200,
        totalDividendsReceived: 194.8,
        finalEquity: 2394.8,
        estimatedMonthlyDividend: 23.9
    });
    assert.equal(Number((result.totalInvested + result.totalDividendsReceived).toFixed(2)), result.finalEquity);
});

test('simulateDividendReinvestment: cenário sem aporte adicional (apenas reinvestimento de dividendos e acúmulo de caixa)', () => {
    const noContribution = simulateDividendReinvestment({
        initialShares: 100,
        sharePrice: 10,
        monthlyDividendPerShare: 0.1,
        monthlyContribution: 0,
        months: 12
    });

    assert.ok(noContribution.totalShares > 100);
    assert.deepEqual(noContribution, {
        totalShares: 112,
        totalInvested: 1000,
        totalDividendsReceived: 126.6,
        finalEquity: 1126.6,
        estimatedMonthlyDividend: 11.2
    });

    const cashCarryover = simulateDividendReinvestment({
        initialShares: '10',
        sharePrice: '9.90',
        monthlyDividendPerShare: '0.33',
        monthlyContribution: '0',
        months: '3'
    });
    assert.deepEqual(cashCarryover, {
        totalShares: 11,
        totalInvested: 99,
        totalDividendsReceived: 9.9,
        finalEquity: 108.9,
        estimatedMonthlyDividend: 3.63
    });
});

test('simulateDividendReinvestment: cenário defensivo com entradas inválidas ou preço de cota zero retorna fallback seguro', () => {
    assert.deepEqual(simulateDividendReinvestment(), ZERO_REINVEST);
    assert.deepEqual(simulateDividendReinvestment(undefined), ZERO_REINVEST);
    assert.deepEqual(simulateDividendReinvestment(null), ZERO_REINVEST);
    assert.deepEqual(simulateDividendReinvestment({}), ZERO_REINVEST);

    const defensiveCases = [
        { initialShares: 100, sharePrice: 0, monthlyDividendPerShare: 0.1, monthlyContribution: 100, months: 12 },
        { initialShares: 100, sharePrice: -10, monthlyDividendPerShare: 0.1, monthlyContribution: 100, months: 12 },
        { initialShares: -1, sharePrice: 10, monthlyDividendPerShare: 0.1, monthlyContribution: 100, months: 12 },
        { initialShares: 100, sharePrice: 10, monthlyDividendPerShare: -0.1, monthlyContribution: 100, months: 12 },
        { initialShares: 100, sharePrice: 10, monthlyDividendPerShare: 0.1, monthlyContribution: -100, months: 12 },
        { initialShares: 100, sharePrice: 10, monthlyDividendPerShare: 0.1, monthlyContribution: 100, months: 0 },
        { initialShares: 100, sharePrice: 10, monthlyDividendPerShare: 0.1, monthlyContribution: 100, months: -6 },
        { initialShares: 0, sharePrice: 10, monthlyDividendPerShare: 0.1, monthlyContribution: 0, months: 12 }
    ];

    for (const params of defensiveCases) {
        assert.deepEqual(simulateDividendReinvestment(params), ZERO_REINVEST);
    }

    for (const bad of ['invalido', '', '  ', null, undefined, NaN, Infinity, -Infinity]) {
        assert.deepEqual(
            simulateDividendReinvestment({
                initialShares: bad,
                sharePrice: 10,
                monthlyDividendPerShare: 0.1,
                monthlyContribution: 100,
                months: 12
            }),
            ZERO_REINVEST
        );
        assert.deepEqual(
            simulateDividendReinvestment({
                initialShares: 100,
                sharePrice: bad,
                monthlyDividendPerShare: 0.1,
                monthlyContribution: 100,
                months: 12
            }),
            ZERO_REINVEST
        );
        assert.deepEqual(
            simulateDividendReinvestment({
                initialShares: 100,
                sharePrice: 10,
                monthlyDividendPerShare: bad,
                monthlyContribution: 100,
                months: 12
            }),
            ZERO_REINVEST
        );
        assert.deepEqual(
            simulateDividendReinvestment({
                initialShares: 100,
                sharePrice: 10,
                monthlyDividendPerShare: 0.1,
                monthlyContribution: bad,
                months: 12
            }),
            ZERO_REINVEST
        );
        assert.deepEqual(
            simulateDividendReinvestment({
                initialShares: 100,
                sharePrice: 10,
                monthlyDividendPerShare: 0.1,
                monthlyContribution: 100,
                months: bad
            }),
            ZERO_REINVEST
        );
    }
});

test('MarketCore expõe calculateCompoundInterest e simulateDividendReinvestment em Node.js e no navegador', () => {
    const source = fs.readFileSync(path.join(__dirname, '../market-core.js'), 'utf8');
    const browserContext = {};
    browserContext.globalThis = browserContext;
    vm.runInNewContext(source, browserContext);

    assert.equal(typeof browserContext.MarketCore?.calculateCompoundInterest, 'function');
    assert.equal(typeof browserContext.MarketCore?.simulateDividendReinvestment, 'function');
    assert.equal(typeof browserContext.MarketCore?.estimateDividends, 'function');
});

test('UI Planejamento Financeiro & Simulações possui estrutura semântica, IDs únicos e integração DOM sem reload', () => {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    assert.match(html, /Planejamento Financeiro &amp; Simulações/);
    assert.match(html, /Calculadora de Juros Compostos/);
    assert.match(html, /Simulador de Reinvestimento de Dividendos/);
    assert.match(html, /Usar Cotação Atual/);

    const requiredIds = [
        'planning-section', 'tab-compound', 'tab-reinvest', 'panel-compound', 'panel-reinvest',
        'compound-form', 'ci-initial', 'ci-monthly', 'ci-rate', 'ci-months', 'ci-calculate-btn',
        'ci-total-invested', 'ci-total-interest', 'ci-final-balance',
        'reinvest-form', 'dr-use-quote-btn', 'dr-initial-shares', 'dr-share-price',
        'dr-monthly-dividend', 'dr-monthly-contribution', 'dr-months', 'dr-simulate-btn',
        'dr-total-shares', 'dr-total-invested', 'dr-total-dividends', 'dr-final-equity', 'dr-estimated-dividend'
    ];
    for (const id of requiredIds) {
        assert.ok(html.includes(`id="${id}"`), `ID obrigatório ausente no HTML: ${id}`);
    }

    const allIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(allIds).size, allIds.length);

    // Simula execução real do script.js no DOM sem reload de página
    function createMockElement(id = '') {
        const classes = new Set(id === 'panel-reinvest' || id.endsWith('feedback') ? ['hidden'] : []);
        const listeners = new Map();
        const attrs = new Map();
        return {
            id,
            value: '',
            textContent: '',
            disabled: false,
            style: {},
            classList: {
                add: (...names) => names.forEach(n => classes.add(n)),
                remove: (...names) => names.forEach(n => classes.delete(n)),
                toggle: (name, force) => {
                    const add = force === undefined ? !classes.has(name) : Boolean(force);
                    if (add) classes.add(name); else classes.delete(name);
                    return add;
                },
                contains: name => classes.has(name)
            },
            set className(val) {
                classes.clear();
                String(val).split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
            },
            get className() { return [...classes].join(' '); },
            setAttribute: (k, v) => attrs.set(k, String(v)),
            getAttribute: k => attrs.get(k) ?? null,
            addEventListener: (type, fn) => {
                if (!listeners.has(type)) listeners.set(type, []);
                listeners.get(type).push(fn);
            },
            dispatch: (type, extra = {}) => {
                let prevented = false;
                const ev = { type, preventDefault() { prevented = true; }, ...extra };
                for (const fn of listeners.get(type) || []) fn(ev);
                return prevented;
            },
            replaceChildren: () => {},
            querySelectorAll: () => [],
            append: () => {},
            focus: () => {}
        };
    }

    const domMap = new Map();
    const getEl = id => {
        if (!domMap.has(id)) domMap.set(id, createMockElement(id));
        return domMap.get(id);
    };

    getEl('ci-initial').value = '1000';
    getEl('ci-monthly').value = '200';
    getEl('ci-rate').value = '12';
    getEl('ci-months').value = '12';
    getEl('dr-initial-shares').value = '100';
    getEl('dr-share-price').value = '10.00';
    getEl('dr-monthly-dividend').value = '0.10';
    getEl('dr-monthly-contribution').value = '100.00';
    getEl('dr-months').value = '12';
    getEl('favorites-filter').value = 'todos';

    const storageMap = new Map();
    const ctx = {
        Intl,
        Date,
        Number,
        String,
        Boolean,
        Array,
        Object,
        Math,
        JSON,
        Error,
        console: { warn() {}, error() {}, log() {} },
        FAVORITES_STORAGE: 'local',
        document: {
            readyState: 'complete',
            activeElement: null,
            getElementById: getEl,
            createElement: tag => createMockElement(tag),
            addEventListener: () => {}
        },
        window: {
            localStorage: {
                getItem: k => storageMap.get(k) ?? null,
                setItem: (k, v) => storageMap.set(k, String(v))
            }
        }
    };
    ctx.globalThis = ctx;
    ctx.window.MarketCore = null;

    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../market-core.js'), 'utf8'), ctx);
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../favorites-store.js'), 'utf8'), ctx);
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8'), ctx);

    // 1. Verifica cálculo inicial e novo submit sem reload em Juros Compostos
    assert.match(getEl('ci-total-invested').textContent, /3\.400,00/);
    assert.match(getEl('ci-total-interest').textContent, /263,33/);
    assert.match(getEl('ci-final-balance').textContent, /3\.663,33/);

    getEl('ci-rate').value = '0';
    const ciPrevented = getEl('compound-form').dispatch('submit');
    assert.equal(ciPrevented, true);
    assert.match(getEl('ci-total-interest').textContent, /0,00/);
    assert.equal(getEl('ci-final-balance').textContent, getEl('ci-total-invested').textContent);

    // 2. Verifica troca de abas para Simulador de Reinvestimento
    getEl('tab-reinvest').dispatch('click');
    assert.equal(getEl('panel-reinvest').classList.contains('hidden'), false);
    assert.equal(getEl('panel-compound').classList.contains('hidden'), true);

    assert.equal(getEl('dr-total-shares').textContent, '239 cotas');
    assert.match(getEl('dr-total-invested').textContent, /2\.200,00/);
    assert.match(getEl('dr-total-dividends').textContent, /194,80/);
    assert.match(getEl('dr-final-equity').textContent, /2\.394,80/);
    assert.match(getEl('dr-estimated-dividend').textContent, /23,90/);

    // 3. Verifica botão "Usar Cotação Atual" preenchendo preço e provento do ativo buscado
    vm.runInNewContext(
        `currentFiiData = { ticker: 'HGLG11', nome: 'CSHG Logística', preco: 20.00, dividend_yield: 12, subType: 'fii', type: 'fund' }; updateSaveButtonState();`,
        ctx
    );
    assert.equal(getEl('dr-use-quote-btn').classList.contains('has-quote'), true);
    getEl('dr-use-quote-btn').dispatch('click');
    assert.equal(getEl('dr-share-price').value, '20.00');
    assert.equal(getEl('dr-monthly-dividend').value, '0.20');
    assert.match(getEl('dr-feedback').textContent, /HGLG11/);
});

