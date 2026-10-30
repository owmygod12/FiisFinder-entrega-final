-- MANUAL: a tabela antiga não tem dono. Identifique dono e categoria reais antes de importar.
-- Não atribuir toda a carteira compartilhada automaticamente ao primeiro visitante.
-- Este exemplo usa um mapeamento explícito revisado pelo administrador.
begin;
create temporary table legacy_mapping (legacy_id bigint primary key, owner_id uuid not null, tipo text not null);
-- Preencher com IDs reais de auth.users e registros cuja propriedade foi confirmada:
-- insert into legacy_mapping values (123, 'UUID-DO-PROPRIETARIO', 'fii');
insert into public.favoritos_ativos(user_id, criado_em, ticker, nome, tipo_ativo, preco, dividend_yield, atualizado_em)
select m.owner_id, f.criado_em, upper(trim(f.ticker)), f.nome, m.tipo, f.preco, f.dividend_yield, null
from public.favoritos_fiis f join legacy_mapping m on m.legacy_id=f.id
on conflict (user_id,ticker) do nothing;
-- Cotação legada sem data confiável continua sem data; atualizar pela aplicação após importar.
-- Nenhum registro da tabela antiga é removido ou modificado.
commit;
