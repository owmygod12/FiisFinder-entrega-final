'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const MarketCore = require('../market-core.js');
const { estimateDividends } = MarketCore;

const ZERO_RESULT = Object.freeze({ totalInvested: 0, monthlyYield: 0, annualYield: 0 });
const EXPECTED_KEYS = ['totalInvested', 'monthlyYield', 'annualYield'];

test('estimateDividends calcula projeção exata para cotas de FIIs', () => {
    assert.deepEqual(
        estimateDividends({ price: 10, yieldAnnualPercent: 12, quantity: 100 }),
        { totalInvested: 1000, monthlyYield: 10, annualYield: 120 }
    );

    assert.deepEqual(
        estimateDividends({ price: 10.45, yieldAnnualPercent: 11.85, quantity: 250 }),
        { totalInvested: 2612.5, monthlyYield: 25.8, annualYield: 309.58 }
    );

    assert.deepEqual(
        estimateDividends({ price: 162.4, yieldAnnualPercent: 8.13, quantity: 15 }),
        { totalInvested: 2436, monthlyYield: 16.5, annualYield: 198.05 }
    );
});

test('estimateDividends suporta ações, units e ETFs incluindo Dividend Yield zero', () => {
    assert.deepEqual(
        estimateDividends({ price: 36.8, yieldAnnualPercent: 14.5, quantity: 50 }),
        { totalInvested: 1840, monthlyYield: 22.23, annualYield: 266.8 }
    );

    assert.deepEqual(
        estimateDividends({ price: 125.5, yieldAnnualPercent: 0, quantity: 10 }),
        { totalInvested: 1255, monthlyYield: 0, annualYield: 0 }
    );

    assert.deepEqual(
        estimateDividends({ price: '50', yieldAnnualPercent: '0', quantity: '20' }),
        { totalInvested: 1000, monthlyYield: 0, annualYield: 0 }
    );
});

test('estimateDividends converte strings numéricas de formulários com segurança', () => {
    assert.deepEqual(
        estimateDividends({ price: '10.50', yieldAnnualPercent: '12', quantity: '100' }),
        { totalInvested: 1050, monthlyYield: 10.5, annualYield: 126 }
    );

    assert.deepEqual(
        estimateDividends({ price: '  25.00 ', yieldAnnualPercent: ' 6.5 ', quantity: ' 40  ' }),
        { totalInvested: 1000, monthlyYield: 5.42, annualYield: 65 }
    );
});

test('estimateDividends controla precisão decimal IEEE 754 e arredonda sequencialmente para duas casas', () => {
    const floatCase = estimateDividends({ price: 0.1, yieldAnnualPercent: 120, quantity: 3 });
    assert.deepEqual(floatCase, { totalInvested: 0.3, monthlyYield: 0.03, annualYield: 0.36 });

    const roundingCase = estimateDividends({ price: 19.99, yieldAnnualPercent: 7.33, quantity: 3 });
    assert.deepEqual(roundingCase, { totalInvested: 59.97, monthlyYield: 0.37, annualYield: 4.4 });

    for (const key of EXPECTED_KEYS) {
        assert.equal(typeof roundingCase[key], 'number');
        assert.ok(Number.isFinite(roundingCase[key]));
    }
    assert.deepEqual(Object.keys(roundingCase), EXPECTED_KEYS);
});

test('estimateDividends trata limites extremos positivos e ignora propriedades extras do ativo', () => {
    assert.deepEqual(
        estimateDividends({ price: 0.01, yieldAnnualPercent: 0, quantity: 1 }),
        { totalInvested: 0.01, monthlyYield: 0, annualYield: 0 }
    );

    assert.deepEqual(
        estimateDividends({ price: 158.75, yieldAnnualPercent: 9.45, quantity: 10000 }),
        { totalInvested: 1587500, monthlyYield: 12501.56, annualYield: 150018.75 }
    );

    assert.deepEqual(
        estimateDividends({ ticker: 'MXRF11', subType: 'fii', price: 10, yieldAnnualPercent: 12, quantity: 100 }),
        { totalInvested: 1000, monthlyYield: 10, annualYield: 120 }
    );
});

test('estimateDividends retorna zeros para argumentos ausentes, negativos, zerados ou inválidos', () => {
    assert.deepEqual(estimateDividends(), ZERO_RESULT);
    assert.deepEqual(estimateDividends(undefined), ZERO_RESULT);
    assert.deepEqual(estimateDividends(null), ZERO_RESULT);
    assert.deepEqual(estimateDividends({}), ZERO_RESULT);
    assert.deepEqual(Object.keys(estimateDividends()), EXPECTED_KEYS);

    const invalidCases = [
        { price: 0, yieldAnnualPercent: 12, quantity: 10 },
        { price: -10, yieldAnnualPercent: 12, quantity: 10 },
        { price: 10, yieldAnnualPercent: 12, quantity: 0 },
        { price: 10, yieldAnnualPercent: 12, quantity: -5 },
        { price: 10, yieldAnnualPercent: -0.01, quantity: 10 },
        { price: 10, yieldAnnualPercent: -12, quantity: 10 },
        { price: null, yieldAnnualPercent: 12, quantity: 10 },
        { price: '', yieldAnnualPercent: 12, quantity: 10 },
        { price: 10, yieldAnnualPercent: 12, quantity: null },
        { price: 10, yieldAnnualPercent: 12, quantity: '' }
    ];

    for (const params of invalidCases) {
        assert.deepEqual(estimateDividends(params), ZERO_RESULT);
    }

    for (const bad of [NaN, Infinity, -Infinity, undefined, 'abc', '10,50', {}, [1, 2]]) {
        assert.deepEqual(estimateDividends({ price: bad, yieldAnnualPercent: 12, quantity: 10 }), ZERO_RESULT);
        assert.deepEqual(estimateDividends({ price: 10, yieldAnnualPercent: bad, quantity: 10 }), ZERO_RESULT);
        assert.deepEqual(estimateDividends({ price: 10, yieldAnnualPercent: 12, quantity: bad }), ZERO_RESULT);
    }
});

test('estimateDividends mantém pureza funcional e compatibilidade CommonJS e navegador (MarketCore)', () => {
    assert.equal(typeof MarketCore.estimateDividends, 'function');

    const frozenInput = Object.freeze({ price: 100, yieldAnnualPercent: 12, quantity: 10 });
    const resultA = estimateDividends(frozenInput);
    const resultB = estimateDividends(frozenInput);
    assert.deepEqual(resultA, { totalInvested: 1000, monthlyYield: 10, annualYield: 120 });
    assert.notEqual(resultA, resultB);

    const fallbackMutated = estimateDividends();
    fallbackMutated.totalInvested = 9999;
    assert.deepEqual(estimateDividends(), ZERO_RESULT);

    const source = fs.readFileSync(path.join(__dirname, '../market-core.js'), 'utf8');
    const browserContext = {};
    browserContext.globalThis = browserContext;
    vm.runInNewContext(source, browserContext);
    assert.equal(typeof browserContext.MarketCore?.estimateDividends, 'function');
    const browserResult = browserContext.MarketCore.estimateDividends({ price: 10, yieldAnnualPercent: 12, quantity: 100 });
    assert.deepEqual(
        { ...browserResult },
        { totalInvested: 1000, monthlyYield: 10, annualYield: 120 }
    );
});
