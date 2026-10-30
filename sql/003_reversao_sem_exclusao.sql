-- MANUAL. Antes: configurar FAVORITES_STORAGE='local' e exportar/backupar a nova carteira.
-- Reversão sem perda de registros: arquivar a nova tabela, sem DROP/DELETE.
-- Executar somente se realmente desejar desativar o armazenamento novo.
begin;
alter table public.favoritos_ativos rename to favoritos_ativos_arquivo;
commit;
-- Para restaurar, após revisar conflitos de nomes:
-- alter table public.favoritos_ativos_arquivo rename to favoritos_ativos;
-- A tabela favoritos_fiis permanece intacta, mas não deve ser exposta sem revisar seu RLS.
