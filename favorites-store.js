(function(root) {
    'use strict';
    const C = typeof module === 'object' ? require('./market-core.js') : root.MarketCore;
    const fields = 'id,criado_em,ticker,nome,tipo_ativo,preco,dividend_yield,variacao,atualizado_em';
    function record(asset) {
        if (!C.validFavorite(asset)) throw new Error('Exige categoria confirmada no catálogo, ticker, nome, cotação e data válidos. Índices não são suportados.');
        return { ticker: asset.ticker, nome: asset.nome, tipo_ativo: C.assetType(asset), preco: asset.preco,
            dividend_yield: C.finite(asset.dividend_yield) ? asset.dividend_yield : null,
            variacao: C.finite(asset.variacao) ? asset.variacao : null, atualizado_em: asset.atualizado_em };
    }
    class FavoritesStore {
        constructor({ storage, client = null, userId = null } = {}) { this.storage = storage; this.client = client; this.userId = userId; this.key = 'fiisfinder.ativos.v1'; this.busy = false; }
        async list() {
            if (this.client) {
                if (!this.userId) throw new Error('Conecte sua carteira primeiro.');
                const { data, error } = await this.client.from('favoritos_ativos').select(fields).eq('user_id', this.userId).order('criado_em', { ascending: false });
                if (error) throw new Error('Não foi possível ler a carteira. Verifique sessão, migração e RLS.');
                return Array.isArray(data) ? data : [];
            }
            let data;
            try { data = JSON.parse(this.storage.getItem(this.key) || '[]'); } catch { throw new Error('Carteira local inválida; exporte uma cópia antes de restaurá-la.'); }
            if (!Array.isArray(data)) throw new Error('Carteira local inválida.');
            return data;
        }
        async mutate(action) { if (this.busy) throw new Error('Aguarde a operação atual.'); this.busy = true; try { return await action(); } finally { this.busy = false; } }
        async add(asset) { return this.mutate(async () => {
            const item = record(asset), rows = await this.list();
            if (rows.some(row => row.ticker === item.ticker)) throw new Error('Este ativo já está nos favoritos.');
            if (this.client) {
                const { error } = await this.client.from('favoritos_ativos').insert({ ...item, user_id: this.userId });
                if (error) throw new Error(error.code === '23505' ? 'Este ativo já está nos favoritos.' : 'Falha ao salvar. Verifique sessão e RLS.');
            } else this.storage.setItem(this.key, JSON.stringify([{ ...item, id: item.ticker, criado_em: new Date().toISOString() }, ...rows]));
        }); }
        async remove(id) { return this.mutate(async () => {
            if (this.client) {
                const { data, error } = await this.client.from('favoritos_ativos').delete().eq('user_id', this.userId).eq('id', id).select('id');
                if (error || !data?.length) throw new Error('Exclusão não confirmada. Verifique sessão e RLS.');
            } else this.storage.setItem(this.key, JSON.stringify((await this.list()).filter(row => String(row.id) !== String(id))));
        }); }
        async update(id, asset) { return this.mutate(async () => {
            const item = record(asset), rows = await this.list(), old = rows.find(row => String(row.id) === String(id));
            if (!old || old.ticker !== item.ticker) throw new Error('Ativo não encontrado na carteira.');
            if (this.client) {
                const { data, error } = await this.client.from('favoritos_ativos').update(item).eq('user_id', this.userId).eq('id', id).select('id');
                if (error || !data?.length) throw new Error('Atualização não confirmada. Verifique sessão e RLS.');
            } else this.storage.setItem(this.key, JSON.stringify(rows.map(row => String(row.id) === String(id) ? { ...row, ...item } : row)));
        }); }
    }
    if (typeof module === 'object') module.exports = { FavoritesStore, record }; else root.FavoritesStore = FavoritesStore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
