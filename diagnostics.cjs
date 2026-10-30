'use strict';
// Diagnóstico somente de leitura: não imprime tokens nem corpos brutos do provedor.
const fs = require('node:fs');
const path = require('node:path');
const { BrapiProvider } = require('./market-service.cjs');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
const provider = new BrapiProvider();
console.log(JSON.stringify({ envFile: fs.existsSync(envPath), authConfigured: Boolean(provider.token), provider: provider.name }));
(async () => {
    for (const ticker of ['PETR3', 'PETR4', 'ITUB4', 'MXRF11', '^BVSP']) {
        const target = new URL('https://brapi.dev/api/quote/' + encodeURIComponent(ticker));
        target.search = 'range=1mo&interval=1d';
        const result = await provider.request(target);
        const quote = result.data?.results?.find(item => item?.symbol === ticker);
        console.log(JSON.stringify({ ticker, http: result.status, code: result.data.code,
            quoteAvailable: Number.isFinite(quote?.regularMarketPrice), historicalPoints: quote?.historicalDataPrice?.length || 0 }));
        if (result.status === 429) break;
    }
})().catch(() => { console.error('Diagnóstico não concluído. Verifique a conexão.'); process.exitCode = 1; });
