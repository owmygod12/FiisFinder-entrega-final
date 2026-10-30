-- Revisar e executar manualmente. Não altera favoritos_fiis nem suas políticas.
begin;
create table public.favoritos_ativos (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id),
 criado_em timestamptz not null default now(),
 ticker text not null check (ticker ~ '^[A-Z]{4}[0-9]{1,2}$'),
 nome text not null check (length(trim(nome)) > 0),
 tipo_ativo text not null check (tipo_ativo in ('acao','fii','etf','unit')),
 preco numeric not null check (preco > 0 and preco <> 'NaN'::numeric and preco <> 'Infinity'::numeric),
 dividend_yield numeric,
 variacao numeric,
 atualizado_em timestamptz,
 unique(user_id, ticker)
);
alter table public.favoritos_ativos enable row level security;
revoke all on public.favoritos_ativos from anon;
grant select, insert, update, delete on public.favoritos_ativos to authenticated;
grant usage, select on sequence public.favoritos_ativos_id_seq to authenticated;
create policy ativos_select on public.favoritos_ativos for select to authenticated using ((select auth.uid()) = user_id);
create policy ativos_insert on public.favoritos_ativos for insert to authenticated with check ((select auth.uid()) = user_id);
create policy ativos_update on public.favoritos_ativos for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy ativos_delete on public.favoritos_ativos for delete to authenticated using ((select auth.uid()) = user_id);
commit;

-- Auditoria somente leitura: conferir políticas também na tabela legada.
select tablename, policyname, roles, cmd, qual, with_check from pg_policies
where schemaname = 'public' and tablename in ('favoritos_fiis','favoritos_ativos');
