/* Integração de mercado. Cotações e históricos sempre vêm da API. */
(() => {
    'use strict';
    const C = MarketCore;
    const $ = id => document.getElementById(id);
    const fallback = [
        ['ITUB3', 'Itaú Unibanco ON'], ['ITUB4', 'Itaú Unibanco PN'],
        ['BPAC3', 'BTG Pactual ON'], ['BPAC5', 'BTG Pactual PN'], ['BPAC11', 'BTG Pactual Units'],
        ['PETR3', 'Petrobras ON'], ['PETR4', 'Petrobras PN'], ['VALE3', 'Vale ON'],
        ['MXRF11', 'Maxi Renda FII'], ['KNCR11', 'Kinea Rendimentos Imobiliários'], ['^BVSP', 'Ibovespa']
    ].map(([ticker, name]) => ({ ticker, name, source: 'local' }));
    const known = new Map();
    let suggestions = [], active = -1, debounce, suggestionVersion = 0, quoteVersion = 0, chartVersion = 0;
    let suggestionAbort, quoteAbort, chartAbort, chart;
    let selected = { ticker: '^BVSP', name: 'Ibovespa', isIndex: true };
    const dateTime = value => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value));
    async function request(path, signal) {
        let response;
        try { response = await fetch('/api/market/' + path, { signal }); }
        catch (error) { if (error.name === 'AbortError') throw error; throw Object.assign(new Error('Não foi possível conectar à API local. Inicie o servidor Node.js ou os serviços web e api do Compose.'), { code: 'LOCAL_NETWORK' }); }
        let data;
        try { data = await response.json(); }
        catch { throw new Error('A rota de mercado não retornou JSON. Verifique se está usando a versão com backend e se o proxy Nginx está ativo.'); }
        if (!response.ok || data?.error) {
            const codes = {
                AUTH_MISSING: 'Este ativo exige autenticação na Brapi. Configure BRAPI_TOKEN no .env do servidor e reinicie a API.',
                AUTH_INVALID: 'Credencial Brapi recusada. Verifique a chave no servidor e reinicie a API.',
                ACCESS_DENIED: 'A Brapi negou acesso (403); não há confirmação de restrição de plano. Verifique permissões da chave e bloqueios do provedor.',
                PLAN_RESTRICTED: 'A Brapi informou restrição de assinatura para este recurso.',
                BAD_REQUEST: 'Ticker, período ou intervalo não aceito pela fonte.',
                NOT_FOUND: 'Ativo não encontrado na fonte.', NO_QUOTE: 'A fonte não retornou uma cotação válida.',
                NO_HISTORY: 'Histórico indisponível para este ativo, período e intervalo.',
                RATE_LIMIT: 'Limite de consultas atingido. Aguarde antes de tentar novamente.',
                NETWORK_ERROR: 'O servidor não conseguiu conectar à fonte de mercado.', TIMEOUT: 'A fonte de mercado demorou para responder.',
                INVALID_RESPONSE: 'A fonte retornou dados inválidos.', UPSTREAM_ERROR: 'Falha temporária na fonte de mercado.', BUSY: 'Servidor ocupado. Tente novamente em instantes.'
            };
            const defaults = { 400: codes.BAD_REQUEST, 401: codes.AUTH_INVALID, 403: codes.ACCESS_DENIED, 404: codes.NOT_FOUND, 429: codes.RATE_LIMIT,
                502: 'A API local não conseguiu obter os dados. Verifique o serviço api e sua conexão.', 503: codes.UPSTREAM_ERROR, 504: codes.TIMEOUT };
            const retry = response.headers.get('Retry-After');
            throw Object.assign(new Error((codes[data?.code] || defaults[response.status] || 'Falha na integração financeira.') +
                (response.status === 429 && retry ? ' Nova tentativa em ' + retry + ' segundos.' : '')), { code: data?.code, status: response.status });
        }
        if (!data || typeof data !== 'object') throw new Error('A API não disponibilizou dados válidos.');
        return data;
    }
    function closeSuggestions() {
        $('search-suggestions').classList.add('hidden');
        $('ticker-input').setAttribute('aria-expanded', 'false');
        $('ticker-input').removeAttribute('aria-activedescendant');
        active = -1;
    }
    function invalidateSuggestions() {
        clearTimeout(debounce);
        suggestionVersion++;
        suggestionAbort?.abort();
        closeSuggestions();
    }
    function renderSuggestions(items) {
        suggestions = items.slice(0, 12);
        active = -1;
        const list = $('search-suggestions');
        list.replaceChildren();
        for (const [index, asset] of suggestions.entries()) {
            const li = document.createElement('li');
            li.id = `suggestion-${index}`;
            li.setAttribute('role', 'option');
            li.setAttribute('aria-selected', 'false');
            li.textContent = `${asset.name} · ${asset.ticker}`;
            li.addEventListener('mousedown', event => event.preventDefault());
            li.addEventListener('click', () => choose(asset));
            list.append(li);
        }
        list.classList.toggle('hidden', !suggestions.length);
        $('ticker-input').setAttribute('aria-expanded', String(Boolean(suggestions.length)));
    }
    async function find(query, signal) {
        try {
            const data = await request(`list?search=${encodeURIComponent(C.normalize(query))}&limit=30&page=1`, signal);
            const items = C.assets(data);
            items.forEach(item => known.set(item.ticker, item));
            return { items: C.search(items, query), local: false };
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            return { items: C.search(fallback, query), local: true, error: error.message };
        }
    }
    async function suggest() {
        const query = $('ticker-input').value.trim();
        if (!query) return;
        const version = ++suggestionVersion;
        suggestionAbort?.abort();
        suggestionAbort = new AbortController();
        $('search-status').textContent = 'Consultando catálogo Brapi…';
        try {
            const result = await find(query, suggestionAbort.signal);
            if (version !== suggestionVersion) return;
            renderSuggestions(result.items);
            $('search-status').textContent = result.local
                ? `${result.error} Sugestões do catálogo local limitado, sem preços. ${result.items.length ? 'Selecione um ticker.' : 'Nenhuma sugestão local encontrada.'}`
                : result.items.length ? 'Catálogo Brapi. Use as setas e Enter para selecionar.' : 'Nenhum ativo encontrado. Tente outro nome ou ticker.';
        } catch (error) { if (error.name !== 'AbortError' && version === suggestionVersion) $('search-status').textContent = error.message; }
    }
    function choose(asset) {
        invalidateSuggestions();
        $('ticker-input').value = asset.ticker;
        lookup(asset.ticker, asset);
    }
    async function search() {
        const query = $('ticker-input').value.trim();
        invalidateSuggestions();
        quoteAbort?.abort();
        quoteVersion++;
        if (!query) { setUIState('error', 'Informe o nome ou ticker de um ativo.'); return; }
        if (C.isTicker(query)) { await lookup(query.toUpperCase(), known.get(query.toUpperCase())); return; }
        setUIState('idle');
        await suggest();
        // Nomes nunca são enviados ao endpoint de cotação. O usuário escolhe a classe.
    }
    async function lookup(ticker, asset) {
        const version = ++quoteVersion;
        chartVersion++; chartAbort?.abort();
        selected = { ticker, name: asset?.name || ticker, isIndex: asset?.type === 'index' || ticker.startsWith('^') };
        loadChart();
        quoteAbort?.abort();
        quoteAbort = new AbortController();
        const signal = quoteAbort.signal;
        setUIState('loading');
        setFavoriteFeedback('');
        try {
            // O catálogo confirma o subtipo antes de habilitar persistência de FIIs.
            if (!asset || asset.source === 'local') {
                const result = await find(ticker, signal);
                if (version !== quoteVersion) return;
                asset = result.items.find(item => item.ticker === ticker && item.source !== 'local');
            }
            const data = await request(`quote/${encodeURIComponent(ticker)}`, signal);
            if (version !== quoteVersion) return;
            const quote = Array.isArray(data.results) && data.results.find(item => item?.symbol === ticker);
            if (!quote) throw new Error('A API não retornou uma cotação válida para este ticker.');
            elements.fiiName.textContent = quote.longName || quote.shortName || asset?.name || ticker;
            elements.fiiTicker.textContent = ticker;
            elements.fiiLogo.style.display = 'none';
            if (typeof quote.logourl === 'string' && /^https:\/\//.test(quote.logourl)) {
                elements.fiiLogo.src = quote.logourl;
                elements.fiiLogo.style.display = 'block';
            }
            const isIndex = asset?.type === 'index' || ticker.startsWith('^');
            const priceText = value => isIndex ? (C.finite(value) ? `${value.toLocaleString('pt-BR')} pontos` : 'Indisponível') : formatCurrency(value);
            elements.fiiPrice.textContent = priceText(quote.regularMarketPrice);
            elements.fiiVariation.textContent = formatVariation(quote.regularMarketChangePercent, elements.fiiVariation);
            elements.fiiMin.textContent = priceText(quote.fiftyTwoWeekLow);
            elements.fiiMax.textContent = priceText(quote.fiftyTwoWeekHigh);
            elements.fiiVolume.textContent = C.finite(quote.regularMarketVolume) ? quote.regularMarketVolume.toLocaleString('pt-BR') : 'Indisponível';
            elements.fiiMarketCap.textContent = formatCompactNumber(quote.marketCap);
            currentFiiData = { ticker, nome: elements.fiiName.textContent, preco: quote.regularMarketPrice,
                dividend_yield: C.finite(quote.dividendYield) ? quote.dividendYield : null, subType: asset?.subType, type: asset?.type, variacao: C.finite(quote.regularMarketChangePercent) ? quote.regularMarketChangePercent : null, atualizado_em: quote.regularMarketTime };
            updateSaveButtonState(ticker);
            if (!C.finite(currentFiiData.preco) || currentFiiData.preco <= 0) elements.saveFavoriteBtn.disabled = true;
            setUIState('success');
            const indexChanged = selected.isIndex !== isIndex;
            selected = { ticker, name: elements.fiiName.textContent, isIndex };
            $('chart-asset').textContent = selected.name + ' · ' + ticker;
            if (indexChanged) loadChart();
        } catch (error) { if (error.name !== 'AbortError' && version === quoteVersion) setUIState('error', error.message); }
    }
    async function loadChart() {
        const version = ++chartVersion;
        chartAbort?.abort();
        chartAbort = new AbortController();
        chart?.destroy(); chart = null;
        $('market-chart').classList.add('hidden');
        $('market-chart').parentElement.classList.add('hidden');
        $('chart-asset').textContent = `${selected.name} · ${selected.ticker}`;
        $('chart-status').textContent = 'Carregando histórico real da Brapi…';
        try {
            const { range, interval } = C.periodParams($('chart-period').value);
            const data = await request(`quote/${encodeURIComponent(selected.ticker)}?range=${range}&interval=${interval}`, chartAbort.signal);
            if (version !== chartVersion) return;
            const quote = data.results?.find(item => item?.symbol === selected.ticker);
            if (!quote) throw new Error('Histórico indisponível para este ativo.');
            if ((Array.isArray(quote.validRanges) && !quote.validRanges.includes(range)) ||
                (Array.isArray(quote.validIntervals) && !quote.validIntervals.includes(interval))) throw new Error('Período ou intervalo indisponível para este ativo/plano.');
            const series = C.chartData(quote.historicalDataPrice, interval);
            const points = series.points;
            if (!points.length) throw new Error('A API não disponibilizou histórico para este ativo e período.');
            if (typeof Chart === 'undefined') throw new Error('Não foi possível carregar a biblioteca do gráfico. Recarregue a página.');
            const positive = points.at(-1).close >= points[0].close;
            const color = positive ? '#4ADE80' : '#F87171';
            $('market-chart').classList.remove('hidden');
            $('market-chart').parentElement.classList.remove('hidden');
            chart = new Chart($('market-chart'), { type: 'line', data: {
                labels: series.labels,
                datasets: [{ label: selected.isIndex ? 'Pontos' : 'Preço (R$)', data: series.values, borderColor: color,
                    backgroundColor: positive ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)', fill: true, borderWidth: 2, pointRadius: points.length === 1 ? 3 : 0, tension: 0.1 }]
            }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => selected.isIndex ? `${ctx.parsed.y.toLocaleString('pt-BR')} pontos` : formatCurrency(ctx.parsed.y) } } },
                scales: { x: { ticks: { color: '#909296', maxTicksLimit: 6, maxRotation: 0 }, grid: { display: false } },
                    y: { ticks: { color: '#909296' }, grid: { color: '#2C2E33' } } } } });
            $('market-chart').setAttribute('aria-label', `${selected.name}, ${selected.ticker}: ${points.length} cotações. De ${points[0].close} a ${points.at(-1).close}.`);
            $('chart-status').textContent = `${points.length} pontos reais · ${positive ? 'Alta ou estabilidade' : 'Queda'} no intervalo · Último registro: ${series.labels.at(-1)}. Intervalo: ${interval}. Fonte: ${data._market?.provider || 'Brapi'}${data._market?.fallback ? ' (alternativa)' : ''}.`;
        } catch (error) { if (error.name !== 'AbortError' && version === chartVersion) $('chart-status').textContent = error.message; }
    }
    function renderRanking(id, items) {
        const list = $(id); list.replaceChildren();
        if (!items.length) { const li = document.createElement('li'); li.textContent = 'Nenhum ativo com variação válida nesta direção.'; list.append(li); }
        for (const asset of items) {
            const li = document.createElement('li'), button = document.createElement('button');
            button.type = 'button'; button.className = 'ranking-button';
            const info = document.createElement('span'), ticker = document.createElement('strong'), name = document.createElement('small');
            ticker.textContent = asset.ticker; name.textContent = asset.name; info.append(ticker, name);
            if (asset.time) { const reference = document.createElement('small'); reference.textContent = dateTime(asset.time) + ' (Brasília)'; info.append(reference); }
            const numbers = document.createElement('span'), price = document.createElement('span'), change = document.createElement('small');
            numbers.className = 'ranking-numbers'; price.textContent = formatCurrency(asset.close);
            change.textContent = `${asset.change > 0 ? '+' : ''}${asset.change.toFixed(2).replace('.', ',')}%`;
            change.className = asset.change > 0 ? 'text-positive' : 'text-negative';
            numbers.append(price, change); button.append(info, numbers); button.addEventListener('click', () => choose(asset)); li.append(button); list.append(li);
        }
    }
    async function loadRankings() {
        const universe = ['PETR4', 'VALE3', 'ITUB4', 'MGLU3'];
        $('refresh-rankings').disabled = true;
        $('rankings-status').textContent = 'Consultando amostra limitada: PETR4, VALE3, ITUB4 e MGLU3…';
        $('gainers-list').replaceChildren(); $('losers-list').replaceChildren();
        const items = [], failures = [];
        try {
            for (const ticker of universe) {
                try {
                    const data = await request('quote/' + ticker);
                    const quote = data.results?.find(item => item?.symbol === ticker);
                    if (!quote) { failures.push(ticker); continue; }
                    const time = typeof quote.regularMarketTime === 'number' ? quote.regularMarketTime * 1000 : Date.parse(quote.regularMarketTime);
                    if (!Number.isFinite(time)) { failures.push(ticker); continue; }
                    const tradingDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time));
                    items.push({ ticker, name: quote.longName || quote.shortName || ticker, close: quote.regularMarketPrice,
                        change: quote.regularMarketChangePercent, time, tradingDay });
                } catch (error) {
                    failures.push(ticker);
                    // Não insistir nos outros ativos após sinal de limite ou indisponibilidade.
                    if (['RATE_LIMIT', 'AUTH_MISSING', 'AUTH_INVALID'].includes(error.code)) { failures.push(...universe.slice(universe.indexOf(ticker) + 1)); break; }
                }
            }
            const latest = items.reduce((value, item) => Math.max(value, item.time), 0);
            const reference = items.find(item => item.time === latest)?.tradingDay;
            const sameDay = items.filter(item => item.tradingDay === reference);
            const result = C.rank(sameDay);
            renderRanking('gainers-list', result.gainers); renderRanking('losers-list', result.losers);
            $('rankings-status').textContent = 'Universo limitado aos quatro tickers de teste público da Brapi: PETR4, VALE3, ITUB4 e MGLU3. Não representa toda a B3. ' +
                result.valid + '/4 ativos válidos no mesmo pregão. Referência do pregão: ' + (reference || 'indisponível') +
                (latest ? '. Última cotação: ' + dateTime(latest) + ' (Brasília).' : '.') +
                (result.valid < 4 ? ' Resultado incompleto: ativos sem preço, variação, data ou com pregão diferente foram excluídos.' : '') +
                (failures.length ? ' Falha de consulta: ' + failures.join(', ') + '.' : '');
        } finally { $('refresh-rankings').disabled = false; }
    }
    $('ticker-input').addEventListener('input', () => {
        invalidateSuggestions(); quoteVersion++; quoteAbort?.abort(); chartVersion++; chartAbort?.abort();
        setUIState('idle'); $('search-status').textContent = '';
        if ($('ticker-input').value.trim()) debounce = setTimeout(suggest, 350);
    });
    $('ticker-input').addEventListener('keydown', event => {
        const open = !$('search-suggestions').classList.contains('hidden');
        if (event.key === 'Escape') { invalidateSuggestions(); return; }
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && open && suggestions.length) {
            event.preventDefault(); active = (active + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
            [...$('search-suggestions').children].forEach((item, index) => item.setAttribute('aria-selected', String(index === active)));
            const option = $('search-suggestions').children[active]; $('ticker-input').setAttribute('aria-activedescendant', option.id); option.scrollIntoView({ block: 'nearest' });
        }
        if (event.key === 'Enter') { event.preventDefault(); if (open && active >= 0) choose(suggestions[active]); else search(); }
    });
    document.addEventListener('click', event => { if (!event.target.closest('#search-section')) invalidateSuggestions(); });
    $('search-btn').addEventListener('click', search);
    $('chart-period').addEventListener('change', loadChart);
    $('refresh-rankings').addEventListener('click', loadRankings);
    window.FIIsMarket = { search, choose };
    async function diagnose() {
        try {
            const data = await request('health');
            $('integration-status').textContent = data.authConfigured
                ? 'API local conectada. Credencial Brapi configurada; validade e permissões são verificadas a cada consulta.'
                : 'API local conectada sem token Brapi. PETR4, VALE3, ITUB4 e MGLU3 permitem teste público. Outros ativos, incluindo PETR3 e Ibovespa, podem exigir autenticação.';
        } catch (error) { $('integration-status').textContent = error.message; }
    }
    diagnose(); loadChart(); loadRankings();
})();
