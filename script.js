// ==========================================================================
// Configurações Globais da API Brapi & Controle de Rede (Etapa 01)
// ==========================================================================

// ==========================================================================
// Estado e Cliente Supabase (Etapa 02 - Sprint 7)
// ==========================================================================
let supabaseClient = null;
let cachedFavorites = [];
let currentFiiData = null;
let savingFavorite = false;

// ==========================================================================
// Captura de referências do DOM
// ==========================================================================
const elements = {
    // Sugestões de pesquisa
    searchSuggestions: document.getElementById('search-suggestions'),

    // Busca e Estados (Etapa 01)
    tickerInput: document.getElementById('ticker-input'),
    searchBtn: document.getElementById('search-btn'),
    errorState: document.getElementById('error-state'),
    loadingState: document.getElementById('loading-state'),
    resultCard: document.getElementById('result-card'),
    fiiLogo: document.getElementById('fii-logo'),
    fiiName: document.getElementById('fii-name'),
    fiiTicker: document.getElementById('fii-ticker'),
    fiiPrice: document.getElementById('fii-price'),
    fiiVariation: document.getElementById('fii-variation'),
    fiiMin: document.getElementById('fii-min'),
    fiiMax: document.getElementById('fii-max'),
    fiiVolume: document.getElementById('fii-volume'),
    fiiMarketCap: document.getElementById('fii-market-cap'),

    // CRUD e Favoritos (Etapa 02 - Sprint 7)
    saveFavoriteBtn: document.getElementById('save-favorite-btn'),
    favoriteFeedback: document.getElementById('favorite-feedback'),
    favoritesCount: document.getElementById('favorites-count'),
    favoritesLoading: document.getElementById('favorites-loading'),
    favoritesEmpty: document.getElementById('favorites-empty'),
    favoritesList: document.getElementById('favorites-list')
};

// ==========================================================================
// Utilitários de Formatação & Segurança
// ==========================================================================
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Utilitário para formatar moeda (BRL)
function formatCurrency(value) {
    if (!MarketCore.finite(value)) return 'N/A';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

// Utilitário para compactar grandes números (M, B)
function formatCompactNumber(value) {
    if (!MarketCore.finite(value)) return 'N/A';
    if (value >= 1e9) {
        return `R$ ${(value / 1e9).toFixed(1).replace('.', ',')} B`;
    }
    if (value >= 1e6) {
        return `R$ ${(value / 1e6).toFixed(1).replace('.', ',')} M`;
    }
    return formatCurrency(value);
}

// Utilitário para formatar variação com sinal
function formatVariation(value, element) {
    element.classList.remove('text-positive', 'text-negative');
    if (!MarketCore.finite(value)) return 'Indisponível';
    
    if (value > 0) {
        element.classList.add('text-positive');
        return `+${value.toFixed(2).replace('.', ',')}%`;
    } else if (value < 0) {
        element.classList.add('text-negative');
        return `${value.toFixed(2).replace('.', ',')}%`;
    }
    
    return `0,00%`;
}

// ==========================================================================
// Máquina de Estados da Interface Principal (Etapa 01)
// ==========================================================================
function setUIState(state, errorMessage = "Informe um nome ou ticker válido.") {
    // Reseta a visibilidade de todos os contêineres dinâmicos de busca
    elements.errorState.classList.add('hidden');
    elements.loadingState.classList.add('hidden');
    elements.resultCard.classList.add('hidden');

    switch (state) {
        case 'idle':
            break;
        case 'loading':
            elements.loadingState.classList.remove('hidden');
            break;
        case 'error':
            elements.errorState.textContent = errorMessage;
            elements.errorState.classList.remove('hidden');
            break;
        case 'success':
            elements.resultCard.classList.remove('hidden');
            break;
    }
}

// ==========================================================================
// Instanciação Defensiva do Cliente Supabase (Sprint 7)
// ==========================================================================
function initSupabase() {
    try {
        if (typeof window.supabase !== 'undefined' && typeof SUPABASE_URL !== 'undefined' && typeof SUPABASE_ANON_KEY !== 'undefined') {
            const isPlaceholder = SUPABASE_URL.includes("SEU-PROJETO") || SUPABASE_ANON_KEY.includes("COLE_AQUI");
            let isPublicKey = SUPABASE_ANON_KEY.startsWith('sb_publishable_');
            if (SUPABASE_ANON_KEY.startsWith('eyJ')) {
                try { isPublicKey = JSON.parse(atob(SUPABASE_ANON_KEY.split('.')[1])).role === 'anon'; } catch { isPublicKey = false; }
            }
            if (!isPlaceholder && isPublicKey && SUPABASE_URL.startsWith("https://")) {
                supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
                return true;
            }
        }
    } catch (err) {
        console.error('Operação indisponível; consulte a mensagem na interface.');
    }
    console.warn("Supabase não configurado ou credenciais pendentes em config.js.");
    return false;
}

// ==========================================================================
// Gerenciamento Visual do Botão e Feedback de Favoritos (Sprint 7)
// ==========================================================================
function setFavoriteFeedback(message, type = 'info') {
    if (!elements.favoriteFeedback) return;
    
    if (!message) {
        elements.favoriteFeedback.className = 'favorite-feedback hidden';
        elements.favoriteFeedback.textContent = '';
        return;
    }

    elements.favoriteFeedback.className = 'favorite-feedback';
    if (type === 'error') {
        elements.favoriteFeedback.classList.add('feedback-error');
    } else if (type === 'success') {
        elements.favoriteFeedback.classList.add('feedback-success');
    }
    elements.favoriteFeedback.textContent = message;
    elements.favoriteFeedback.classList.remove('hidden');
}


let favoriteStore;
const typeLabels = { acao: 'Ação', fii: 'FII', etf: 'ETF', unit: 'Unit' };
function updateSaveButtonState() {
    const saved = cachedFavorites.some(row => row.ticker === currentFiiData?.ticker);
    elements.saveFavoriteBtn.disabled = savingFavorite || !favoriteStore || !MarketCore.validFavorite(currentFiiData) || saved;
    elements.saveFavoriteBtn.textContent = savingFavorite ? 'Salvando...' : saved ? 'Salvo nos favoritos' : 'Adicionar aos favoritos';
    if (typeof syncQuoteToSimulatorState === 'function') syncQuoteToSimulatorState();
}
async function loadFavorites() {
    if (!favoriteStore) return;
    elements.favoritesLoading.classList.remove('hidden');
    try { cachedFavorites = await favoriteStore.list(); renderFavoritesList(); }
    catch(error) { document.getElementById('favorites-error').textContent = error.message; }
    finally { elements.favoritesLoading.classList.add('hidden'); updateSaveButtonState(); }
}
async function handleAddFavorite() {
    if (savingFavorite || !favoriteStore || !MarketCore.validFavorite(currentFiiData)) return;
    savingFavorite = true; updateSaveButtonState();
    try { await favoriteStore.add({ ...currentFiiData }); await loadFavorites(); setFavoriteFeedback('Ativo adicionado aos favoritos!', 'success'); }
    catch(error) { setFavoriteFeedback(error.message, 'error'); }
    finally { savingFavorite = false; updateSaveButtonState(); }
}
function renderFavoritesList() {
    const filter = document.getElementById('favorites-filter').value;
    const rows = cachedFavorites.filter(row => filter === 'todos' || row.tipo_ativo === filter);
    elements.favoritesCount.textContent = cachedFavorites.length;
    elements.favoritesEmpty.classList.toggle('hidden', rows.length !== 0);
    elements.favoritesList.replaceChildren();
    for (const row of rows) {
        const card = document.createElement('li'); card.className = 'favorite-card';
        const info = document.createElement('div'); info.className = 'fav-info';
        const details = document.createElement('button'); details.type = 'button'; details.className = 'favorite-details';
        details.textContent = row.ticker + ' · ' + row.nome; details.addEventListener('click', () => window.FIIsMarket.choose({ ticker: row.ticker, name: row.nome }));
        const metrics = document.createElement('div'); metrics.className = 'fav-metrics';
        const price = document.createElement('span'); price.textContent = (typeLabels[row.tipo_ativo] || 'Tipo não confirmado') + ' · ' + formatCurrency(Number(row.preco));
        const change = document.createElement('span'); change.textContent = formatVariation(row.variacao, change);
        const date = document.createElement('small'); date.textContent = 'Cotação: ' + (Number.isFinite(Date.parse(row.atualizado_em)) ? new Date(row.atualizado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' (Brasília)' : 'data indisponível');
        metrics.append(price, change); info.append(details, metrics, date);
        const actions = document.createElement('div'); actions.className = 'favorite-actions';
        for (const [label, action] of [['Atualizar', () => refreshFavorite(row)], ['Excluir', () => favoriteStore.remove(row.id)]]) {
            const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
            button.addEventListener('click', async () => {
                if (savingFavorite) return;
                savingFavorite = true; updateSaveButtonState();
                elements.favoritesList.querySelectorAll('button').forEach(item => item.disabled = true);
                try { await action(); document.getElementById('favorites-error').textContent = ''; }
                catch(error) { document.getElementById('favorites-error').textContent = error.message; }
                finally { savingFavorite = false; await loadFavorites(); }
            }); actions.append(button);
        }
        card.append(info, actions); elements.favoritesList.append(card);
    }
}
async function refreshFavorite(row) {
    const response = await fetch('/api/market/quote/' + encodeURIComponent(row.ticker));
    const data = await response.json();
    if (!response.ok) throw new Error('Não foi possível atualizar a cotação. O valor anterior foi preservado.');
    const quote = data.results?.find(item => item.symbol === row.ticker);
    const catalogResponse = await fetch('/api/market/list?search=' + encodeURIComponent(row.ticker) + '&limit=30&page=1');
    if (!catalogResponse.ok) throw new Error('Não foi possível confirmar a categoria no catálogo.');
    const asset = MarketCore.assets(await catalogResponse.json()).find(item => item.ticker === row.ticker);
    await favoriteStore.update(row.id, { ticker: row.ticker, nome: quote?.longName || quote?.shortName || row.nome,
        preco: quote?.regularMarketPrice, variacao: quote?.regularMarketChangePercent, atualizado_em: quote?.regularMarketTime,
        dividend_yield: quote?.dividendYield, subType: asset?.subType, type: asset?.type });
}
async function startApp() {
    const remote = typeof FAVORITES_STORAGE !== 'undefined' && FAVORITES_STORAGE === 'supabase';
    const note = document.getElementById('favorites-mode');
    if (!remote) {
        favoriteStore = new FavoritesStore({ storage: window.localStorage });
        note.textContent = 'Carteira local neste navegador. Não é sincronizada com o Supabase. Favoritos legados no banco foram preservados; importação exige migração manual.';
    } else {
        initSupabase();
        if (supabaseClient) supabaseClient.auth.onAuthStateChange((_event, session) => {
            if (favoriteStore && session?.user?.id !== favoriteStore.userId) {
                favoriteStore = null; cachedFavorites = []; renderFavoritesList(); updateSaveButtonState();
                note.textContent = 'Sessão alterada. Conecte novamente a carteira privada.';
            }
        });
        const connect = document.getElementById('favorites-connect'); connect.classList.remove('hidden');
        const bind = async () => {
            if (!supabaseClient) throw new Error('Supabase indisponível.');
            const { data, error } = await supabaseClient.auth.getSession();
            if (error || !data.session?.user) throw new Error('Conecte sua carteira. A sessão anônima pertence somente a este navegador; perdê-la pode impedir acesso aos registros.');
            favoriteStore = new FavoritesStore({ client: supabaseClient, userId: data.session.user.id });
            note.textContent = 'Carteira Supabase privada da sessão atual. Guarde sua sessão; nenhuma carteira de outro usuário é consultada.'; await loadFavorites();
        };
        connect.addEventListener('click', async () => {
            connect.disabled = true;
            try { if (!supabaseClient) throw new Error('Supabase indisponível.'); const { data } = await supabaseClient.auth.getSession();
                if (!data.session) { const { error } = await supabaseClient.auth.signInAnonymously(); if (error) throw new Error('Habilite autenticação anônima no Supabase ou conecte uma sessão autenticada.'); }
                await bind();
            } catch(error) { note.textContent = error.message; } finally { connect.disabled = false; }
        });
        try { await bind(); } catch(error) { note.textContent = error.message; }
    }
    await loadFavorites(); updateSaveButtonState();
}
elements.saveFavoriteBtn.addEventListener('click', handleAddFavorite);
elements.fiiLogo.addEventListener('error', () => elements.fiiLogo.style.display = 'none');
document.getElementById('favorites-filter').addEventListener('change', renderFavoritesList);
// ==========================================================================
// Planejamento Financeiro & Simulações (Juros Compostos e Reinvestimento)
// ==========================================================================
function setPlanningFeedback(elementId, message, type = 'info') {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (!message) {
        el.className = 'favorite-feedback hidden';
        el.textContent = '';
        return;
    }
    el.className = 'favorite-feedback';
    if (type === 'error') el.classList.add('feedback-error');
    else if (type === 'success') el.classList.add('feedback-success');
    el.textContent = message;
    el.classList.remove('hidden');
}

function normalizeCalcValue(rawValue, fallbackIfEmpty = null) {
    const trimmed = String(rawValue ?? '').trim().replace(',', '.');
    if (trimmed === '' && fallbackIfEmpty !== null) return fallbackIfEmpty;
    return trimmed;
}

function hasUsableAssetQuote() {
    return Boolean(
        currentFiiData &&
        MarketCore.finite(currentFiiData.preco) &&
        currentFiiData.preco > 0 &&
        currentFiiData.type !== 'index' &&
        !String(currentFiiData.ticker || '').startsWith('^')
    );
}

function syncQuoteToSimulatorState() {
    const btn = document.getElementById('dr-use-quote-btn');
    const hint = document.getElementById('dr-quote-hint');
    if (!btn) return;
    const ready = hasUsableAssetQuote();
    btn.classList.toggle('has-quote', ready);
    if (hint) {
        hint.textContent = ready
            ? `Ativo consultado: ${currentFiiData.ticker} (${formatCurrency(currentFiiData.preco)}). Clique em "Usar Cotação Atual" para preencher.`
            : 'Busque um ativo acima para importar preço e provento estimado com um clique.';
    }
}

function activatePlanningTab(targetTab) {
    const tabCompound = document.getElementById('tab-compound');
    const tabReinvest = document.getElementById('tab-reinvest');
    const panelCompound = document.getElementById('panel-compound');
    const panelReinvest = document.getElementById('panel-reinvest');
    if (!tabCompound || !tabReinvest || !panelCompound || !panelReinvest) return;

    const isCompound = targetTab === 'compound';
    tabCompound.classList.toggle('is-active', isCompound);
    tabCompound.setAttribute('aria-selected', String(isCompound));
    tabCompound.setAttribute('tabindex', isCompound ? '0' : '-1');

    tabReinvest.classList.toggle('is-active', !isCompound);
    tabReinvest.setAttribute('aria-selected', String(!isCompound));
    tabReinvest.setAttribute('tabindex', !isCompound ? '0' : '-1');

    panelCompound.classList.toggle('hidden', !isCompound);
    panelReinvest.classList.toggle('hidden', isCompound);
}

function runCompoundCalculation() {
    const initialInput = document.getElementById('ci-initial');
    const monthlyInput = document.getElementById('ci-monthly');
    const rateInput = document.getElementById('ci-rate');
    const monthsInput = document.getElementById('ci-months');
    if (!initialInput || !monthlyInput || !rateInput || !monthsInput) return;

    const rawInitial = normalizeCalcValue(initialInput.value, '0');
    const rawMonthly = normalizeCalcValue(monthlyInput.value, '0');
    const rawRate = normalizeCalcValue(rateInput.value);
    const rawMonths = normalizeCalcValue(monthsInput.value);

    const numInitial = Number(rawInitial);
    const numMonthly = Number(rawMonthly);
    const numRate = rawRate === '' ? NaN : Number(rawRate);
    const numMonths = rawMonths === '' ? NaN : Number(rawMonths);

    const isValid =
        Number.isFinite(numInitial) &&
        Number.isFinite(numMonthly) &&
        Number.isFinite(numRate) &&
        Number.isFinite(numMonths) &&
        numInitial >= 0 &&
        numMonthly >= 0 &&
        numRate >= 0 &&
        numMonths > 0 &&
        (numInitial > 0 || numMonthly > 0);

    const result = MarketCore.calculateCompoundInterest({
        initialAmount: rawInitial,
        monthlyContribution: rawMonthly,
        annualRatePercent: rawRate,
        months: rawMonths
    });

    document.getElementById('ci-total-invested').textContent = formatCurrency(result.totalInvested);
    document.getElementById('ci-total-interest').textContent = formatCurrency(result.totalInterest);
    document.getElementById('ci-final-balance').textContent = formatCurrency(result.finalBalance);

    if (!isValid) {
        setPlanningFeedback('ci-feedback', 'Informe valores válidos não negativos, prazo em meses maior que zero e ao menos um aporte.', 'error');
    } else {
        setPlanningFeedback('ci-feedback', '');
    }
}

function runDividendSimulation({ preserveFeedback = false } = {}) {
    const sharesInput = document.getElementById('dr-initial-shares');
    const priceInput = document.getElementById('dr-share-price');
    const dividendInput = document.getElementById('dr-monthly-dividend');
    const contributionInput = document.getElementById('dr-monthly-contribution');
    const monthsInput = document.getElementById('dr-months');
    if (!sharesInput || !priceInput || !dividendInput || !contributionInput || !monthsInput) return;

    const rawShares = normalizeCalcValue(sharesInput.value, '0');
    const rawPrice = normalizeCalcValue(priceInput.value);
    const rawDividend = normalizeCalcValue(dividendInput.value, '0');
    const rawContribution = normalizeCalcValue(contributionInput.value, '0');
    const rawMonths = normalizeCalcValue(monthsInput.value);

    const numShares = Number(rawShares);
    const numPrice = rawPrice === '' ? NaN : Number(rawPrice);
    const numDividend = Number(rawDividend);
    const numContribution = Number(rawContribution);
    const numMonths = rawMonths === '' ? NaN : Number(rawMonths);

    const isValid =
        Number.isFinite(numShares) &&
        Number.isFinite(numPrice) &&
        Number.isFinite(numDividend) &&
        Number.isFinite(numContribution) &&
        Number.isFinite(numMonths) &&
        numShares >= 0 &&
        numPrice > 0 &&
        numDividend >= 0 &&
        numContribution >= 0 &&
        Math.floor(numMonths) > 0 &&
        (numShares > 0 || numContribution > 0);

    const result = MarketCore.simulateDividendReinvestment({
        initialShares: rawShares,
        sharePrice: rawPrice,
        monthlyDividendPerShare: rawDividend,
        monthlyContribution: rawContribution,
        months: rawMonths
    });

    const shareLabel = result.totalShares === 1 ? 'cota' : 'cotas';
    document.getElementById('dr-total-shares').textContent = `${result.totalShares.toLocaleString('pt-BR')} ${shareLabel}`;
    document.getElementById('dr-total-invested').textContent = formatCurrency(result.totalInvested);
    document.getElementById('dr-total-dividends').textContent = formatCurrency(result.totalDividendsReceived);
    document.getElementById('dr-final-equity').textContent = formatCurrency(result.finalEquity);
    document.getElementById('dr-estimated-dividend').textContent = formatCurrency(result.estimatedMonthlyDividend);

    if (!isValid) {
        setPlanningFeedback('dr-feedback', 'Informe preço da cota maior que zero, prazo válido, valores não negativos e cotas iniciais ou aporte mensal.', 'error');
    } else if (!preserveFeedback) {
        setPlanningFeedback('dr-feedback', '');
    }
}

function handleUseCurrentQuote() {
    if (!currentFiiData || !MarketCore.finite(currentFiiData.preco) || currentFiiData.preco <= 0) {
        setPlanningFeedback('dr-feedback', 'Busque um ativo acima antes de usar a cotação atual.', 'error');
        return;
    }
    if (currentFiiData.type === 'index' || String(currentFiiData.ticker || '').startsWith('^')) {
        setPlanningFeedback('dr-feedback', 'Índices não possuem cotas negociáveis nem dividendos. Consulte uma ação, FII, unit ou ETF.', 'error');
        return;
    }

    const priceInput = document.getElementById('dr-share-price');
    const dividendInput = document.getElementById('dr-monthly-dividend');
    if (!priceInput || !dividendInput) return;

    priceInput.value = Number(currentFiiData.preco).toFixed(2);

    if (MarketCore.finite(currentFiiData.dividend_yield) && currentFiiData.dividend_yield >= 0) {
        const estimated = MarketCore.estimateDividends({
            price: currentFiiData.preco,
            yieldAnnualPercent: currentFiiData.dividend_yield,
            quantity: 1
        });
        dividendInput.value = estimated.monthlyYield.toFixed(2);
        setPlanningFeedback(
            'dr-feedback',
            `Cotação (${formatCurrency(currentFiiData.preco)}) e provento mensal estimado (${formatCurrency(estimated.monthlyYield)}/cota) preenchidos com dados de ${currentFiiData.ticker}.`,
            'success'
        );
    } else {
        if (!dividendInput.value || Number(dividendInput.value) < 0) {
            dividendInput.value = '0.00';
        }
        setPlanningFeedback(
            'dr-feedback',
            `Preço de ${currentFiiData.ticker} (${formatCurrency(currentFiiData.preco)}) preenchido. A API não informou Dividend Yield; informe o provento mensal por cota.`,
            'success'
        );
    }

    runDividendSimulation({ preserveFeedback: true });
}

function initPlanningSimulators() {
    const tabCompound = document.getElementById('tab-compound');
    const tabReinvest = document.getElementById('tab-reinvest');
    const compoundForm = document.getElementById('compound-form');
    const reinvestForm = document.getElementById('reinvest-form');
    const useQuoteBtn = document.getElementById('dr-use-quote-btn');

    if (tabCompound && tabReinvest) {
        tabCompound.addEventListener('click', () => activatePlanningTab('compound'));
        tabReinvest.addEventListener('click', () => activatePlanningTab('reinvest'));

        const handleTabKey = event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            const nextIsCompound = document.activeElement === tabReinvest;
            activatePlanningTab(nextIsCompound ? 'compound' : 'reinvest');
            (nextIsCompound ? tabCompound : tabReinvest).focus();
        };
        tabCompound.addEventListener('keydown', handleTabKey);
        tabReinvest.addEventListener('keydown', handleTabKey);
    }

    if (compoundForm) {
        compoundForm.addEventListener('submit', event => {
            event.preventDefault();
            runCompoundCalculation();
        });
    }

    if (reinvestForm) {
        reinvestForm.addEventListener('submit', event => {
            event.preventDefault();
            runDividendSimulation();
        });
    }

    if (useQuoteBtn) {
        useQuoteBtn.addEventListener('click', handleUseCurrentQuote);
    }

    syncQuoteToSimulatorState();
    runCompoundCalculation();
    runDividendSimulation({ preserveFeedback: true });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { initPlanningSimulators(); startApp(); });
} else {
    initPlanningSimulators();
    startApp();
}
