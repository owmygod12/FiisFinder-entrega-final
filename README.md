# FIIsFinder — Etapa 02 (Bootcamp II)

## Carteira genérica de favoritos (substitui as regras exclusivas de FIIs abaixo)

Ações, units, FIIs e ETFs são aceitos somente com subType confirmado pelo catálogo, ticker válido, nome, preço positivo real e data da cotação. Índices e categorias desconhecidas não são suportados. Tipo não é inferido pelo sufixo 11. A interface oferece filtros, atualização individual, exclusão e abertura do ativo no gráfico.

Por segurança, FAVORITES_STORAGE em config.js começa como local: favoritos ficam neste navegador, não são sincronizados nem compartilhados. A carteira antiga do Supabase não é apagada nem importada automaticamente. Não há como atribuir seus registros a usuários com segurança porque favoritos_fiis não possui proprietário. Limpar dados do navegador elimina a carteira local. Não use este modo em um perfil de navegador compartilhado para guardar dados privados.

Para habilitar Supabase, revise e execute manualmente sql/001_favoritos_ativos.sql. Ele cria tabela com user_id, unicidade por usuário/ticker e RLS para SELECT/INSERT/UPDATE/DELETE baseado em auth.uid(). A chave pública é preservada. sql/002_importar_legados.sql recebe mapeamento explícito de registro, proprietário e categoria; preencha somente dados conferidos. O script não remove nem sobrescreve os legados e evita duplicatas. dividend_yield é opcional. A data de cotação legada desconhecida continua nula até atualização pela API. sql/003_reversao_sem_exclusao.sql arquiva a tabela nova por renomeação, sem excluir registros.

Depois da migração, configure FAVORITES_STORAGE='supabase'. Use uma sessão Supabase já autenticada ou habilite Anonymous Sign-ins no painel e clique Conectar carteira privada. Esse clique cria uma identidade anônima apenas se não houver sessão; nenhuma conta é criada automaticamente ao abrir a página. Usuários anônimos autenticados recebem papel authenticated, com RLS por UUID; não confundir com acesso público anon. Perder essa sessão pode impedir recuperar a carteira: para uso duradouro, implemente vinculação a login por email. A carteira local não é enviada automaticamente ao banco. São armazenamentos separados, identificados na tela.

Audite pg_policies com a consulta de 001 antes de ativar o modo remoto. Políticas antigas amplas documentadas no projeto não foram alteradas: deixar de consultar a tabela legada não revoga seu acesso público existente. Revise e restrinja seus grants/policies manualmente após mapear a propriedade e verificar consumidores antigos. Nenhuma migração ou escrita no banco real foi executada pelo agente.

Validação: npm test (36 testes) e npm run check aprovados. No Chrome, PETR4 real foi adicionada, atualizada, filtrada, aberta nos detalhes/gráfico e excluída da carteira local, sem erros JavaScript. O primeiro ensaio de automação usou seletor ambíguo para Atualizar; o ensaio corrigido foi aprovado. SQL e CRUD remoto não foram executados em produção.

Reconstrução: com Docker Desktop ativo, execute docker compose up --build -d, depois docker compose ps. O Dockerfile entrega favorites-store.js; o backend expõe o mesmo arquivo no modo Node local. Não publique docker compose config com o token resolvido. Não foram feitos commits, push ou alterações de branch.



## Diagnóstico e execução atual (Windows 11 / PowerShell)

Em 30/10/2026, esta cópia local não tinha .env nem BRAPI_TOKEN no processo. Sem autenticação, a Brapi retornou HTTP 200 para PETR4 e ITUB4 (22 pontos no histórico de um mês) e HTTP 401 MISSING_TOKEN para PETR3, MXRF11 e ^BVSP. Isso comprova autenticação ausente neste ambiente, não insuficiência de um plano. O 403 relatado não foi reproduzido com uma chave autenticada; a aplicação antiga traduzia todo 403 como limitação comercial e descartava o diagnóstico original.

### Início rápido sem Docker

Instale Node.js 22 ou superior com npm. No PowerShell:

```powershell
Set-Location 'C:\Users\Turi\Documents\FiisFinder-entrega-final'
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
# Opcional: configure uma chave válida em BRAPI_TOKEN no .env. Não cole chaves no chat.
npm start
```

Acesse http://localhost:8080. Sem chave, use PETR4, ITUB4, VALE3 e MGLU3. PETR3 e Ibovespa exigiram autenticação no teste real. O servidor lê .env também quando iniciado por `node server.cjs`; variáveis já definidas no ambiente têm precedência. Após mudar a chave, reinicie a API. A presença de uma chave não comprova sua validade ou permissão de consulta.

### Docker Desktop

Abra o Docker Desktop e aguarde o engine Linux ficar ativo. Valide com `docker info`. Então, na pasta do projeto:

```powershell
docker compose up --build -d
docker compose ps
Invoke-RestMethod http://localhost:8080/healthz
Invoke-RestMethod http://localhost:8080/api/market/health
```

O serviço web publica 8080:80 e encaminha /api/market/ ao serviço api:8080 na rede interna. A API não publica porta no host, e 8081 não é utilizada. O Compose define HOST e PORT explicitamente, inclui health checks e aguarda a API saudável antes de iniciar web. Health saudável indica que o servidor responde; não garante assinatura ou acesso à Brapi. BRAPI_TOKEN entra apenas no ambiente do backend e não é copiado para as imagens.

Não execute imagens antigas isoladas: elas podem conter apenas o frontend. Use os dois serviços deste compose.yaml. Não pare containers existentes para liberar portas automaticamente. Para investigar conflitos:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 8080,8081 -ErrorAction SilentlyContinue
docker ps --format '{{.Names}} {{.Ports}} {{.Status}}'
docker compose logs --tail=100 web api
```

O comando `docker compose config` resolve variáveis e pode mostrar sua chave: confira localmente, mas não publique essa saída. Os logs da aplicação não imprimem credenciais.

### Diagnóstico financeiro e erros

```powershell
npm run diagnose
npm test
npm run check
docker compose config
docker compose ps
```

O diagnóstico consulta sequencialmente os cinco tickers solicitados, imprime somente disponibilidade, status e códigos seguros, e consome chamadas reais. Os testes usam mocks, sem chave nem banco ativo. /api/market/health informa apenas se há uma chave configurada, sem revelar seu valor.

- AUTH_MISSING: falta autenticação exigida pelo ativo.
- AUTH_INVALID: a credencial foi recusada.
- ACCESS_DENIED: 403 sem evidência de assinatura; pode haver permissão ou bloqueio do provedor.
- PLAN_RESTRICTED: a Brapi informou explicitamente restrição comercial.
- RATE_LIMIT: aguardar Retry-After (segundos ou HTTP-date).
- NETWORK_ERROR / TIMEOUT / UPSTREAM_ERROR: falhas de conexão, demora ou servidor externo.
- INVALID_RESPONSE / NO_QUOTE / NO_HISTORY: dados inválidos, cotação ausente ou histórico ausente.

BrapiProvider trata autenticação e respostas; MarketService valida, serializa, agrupa chamadas iguais e mantém cache de sucessos e erros breves. Provedores adicionais podem ser injetados com name, supports(target) e request(target), retornando o mesmo contrato normalizado. A Brapi é sempre a principal. Um fallback só é usado quando configurado, compatível e após falha; a fonte alternativa fica identificada na resposta. Nenhuma alternativa financeira foi ativada nesta entrega.

Históricos diários exibem o dia de referência sem conversão para o dia anterior; intradiários exibem data e hora de Brasília. A área do canvas fica oculta quando não há dados, com explicação ao lado. Índices usam pontos; ações e FIIs usam reais. Os rankings continuam limitados aos quatro ativos públicos indicados, agora com horário de referência por item.

### Alternativas avaliadas

| Fonte | Cobertura/histórico | Autenticação e limites | Decisão |
| --- | --- | --- | --- |
| Brapi | B3, FIIs e ^BVSP pelo endpoint documentado; histórico depende do acesso | Bearer no backend; quatro ações públicas; restrições e concorrência dependem da conta | Principal, validada com dados reais públicos |
| HG Brasil | Ações, FIIs e índices BVSP/IFIX; endpoint histórico documentado | Página de preços anuncia 400 consultas/dia no grátis; documentação do histórico exige chave e plano com suporte | Não foi comprovado histórico gratuito para esta conta; não ativada |
| Twelve Data | B3 listada com dados EOD a partir de Grow | API key; Basic anuncia 8 créditos/minuto e 800/dia, mas não comprova inclusão da B3 | Não é fallback gratuito comprovado para B3; não ativada |
| Fintay | Endpoint documentado para histórico de índices | Exige avaliação da chave e cobertura da conta, não disponíveis aqui | Não validada nem ativada |

Referências oficiais: [Brapi autenticação](https://brapi.dev/docs/authentication), [Brapi cotações/históricos](https://brapi.dev/docs/acoes), [HG histórico](https://console.hgbrasil.com/documentation/finance), [HG preços](https://hgbrasil.com/pricing/?origin=finance), [Twelve Data bolsas](https://twelvedata.com/exchanges?level=overview), [Twelve Data preços](https://twelvedata.com/pricing), [Fintay índices](https://fintay.com.br/docs/api/indices-historico). Não foram utilizados scraping, endpoints privados, dados simulados na aplicação ou serviços pagos.

---


## Evolução da busca e do dashboard — branch feature/melhoria-filtros

Estas instruções substituem a execução estática e o comando Docker isolado descritos no registro histórico abaixo. A interface continua em HTML/CSS/JavaScript Vanilla, com Chart.js para históricos. O Nginx entrega a interface e encaminha /api/market/ a um proxy Node.js pequeno, sem dependências.

### Executar a versão atual

Requer Node.js 22 ou superior. Na pasta do projeto:

```powershell
Copy-Item .env.example .env
# Edite .env e configure BRAPI_TOKEN com uma chave válida, somente no servidor.
node --env-file-if-exists=.env server.cjs
```

Abra http://localhost:8080. Também é possível executar `npm start` onde npm estiver instalado. Não abra apenas index.html nem use Live Server sem encaminhar /api/market/ ao proxy.

Com Docker Desktop em execução e a chave no .env:

```sh
docker compose up --build
```

O navegador acessa somente a porta 8080 do Nginx; a API fica na rede interna do Compose. O Dockerfile do frontend copia explicitamente os arquivos públicos, sem .env ou código do servidor. Não use build/push das imagens antigas para publicar esta alteração.

### Busca, gráficos e cobertura

- Um único botão Buscar, ao lado do campo no desktop e abaixo no celular. Sugestões ficam no fluxo da página.
- Catálogo Brapi em /api/quote/list, busca normalizada com debounce de 350 ms e cancelamento de respostas antigas. Nomes exigem selecionar a classe desejada; nomes nunca viram tickers por suposição.
- Tickers continuam aceitos diretamente; Enter, Escape e setas controlam sugestões. Uma lista local limitada é usada somente quando o catálogo falha, com aviso explícito e sem preços.
- Mercado Financeiro começa em ^BVSP. Há períodos 1d/5d/1mo/6mo/1y e intervalos 5m/30m/1d; os valores aceitos retornados pela API são verificados quando presentes. Recursos sem permissão ou sem histórico mostram indisponibilidade, sem dados inventados.
- Rankings usam amostra fixa e explicitamente limitada aos quatro tickers públicos PETR4, VALE3, ITUB4 e MGLU3. São quatro cotações, sequenciais e com cache. Não representa toda a B3 nem componentes completos do Ibovespa. Registros sem preço, variação ou data válida são excluídos, assim como cotações de pregão diferente do mais recente recebido. A interface informa o pregão e cobertura incompleta.
- Cache do proxy: catálogo por 5 minutos, cotações/históricos por 1 minuto. Chamadas iguais são agrupadas; há somente uma chamada simultânea à Brapi. HTTP 429 respeita Retry-After, sem repetição automática. O plano da conta continua determinando a disponibilidade de ativos, períodos e intervalos.

### Favoritos e segurança

O schema existente permanece: favoritos_fiis(id, criado_em, ticker, nome, preco, dividend_yield). Nenhuma migração, alteração de RLS ou mudança destrutiva foi executada. A chave pública Supabase de config.js foi preservada. O cliente rejeita chaves service_role/secret. Apenas ativos com subType=fii confirmado pelo catálogo podem ser adicionados: índices, ações, units e ativos sem classificação ficam desabilitados. Não foi implementado favorito de ações; isso exige uma migração separada.

O token Brapi anteriormente embutido foi removido do frontend. Ele continua no histórico antigo do Git: revogue/rotacione essa chave no painel Brapi e configure uma nova em BRAPI_TOKEN no .env do servidor. Não reutilize a chave publicada. O proxy usa Authorization, nunca registra segredos e não devolve mensagens privadas do provedor. Não versione .env. A aplicação depende dos CDNs de Supabase e Chart.js; falhas são informadas na interface.

### Verificação

```sh
node --test
node --check script.js
node --check market.js
node --check market-core.js
node --check server.cjs
```

Alternativas: `npm test` e `npm run check`. O workflow .github/workflows/tests.yml executa testes e sintaxe em PRs para main, sem alterar proteções da branch. Os testes usam dados controlados e não dependem de Brapi ou Supabase ativos.

Documentação consultada: [catálogo](https://brapi.dev/docs/acoes/list), [cotação e históricos v1](https://brapi.dev/docs/acoes), [autenticação e limites](https://brapi.dev/docs/authentication). O endpoint v1 foi mantido por compatibilidade com a integração existente; a documentação informa que continua ativo.

---

## Registro da entrega anterior

O texto a seguir preserva a documentação acadêmica anterior. Afirmações de deploy, imagens publicadas e execução de infraestrutura são registros anteriores, não validações desta contribuição.


Aplicação web moderna para consulta, monitoramento e análise de cotações em tempo real de Fundos de Investimento Imobiliário (FIIs) listados na B3. O projeto evoluiu de uma Single Page Application (SPA) puramente estática da Etapa 01 para uma arquitetura robusta de microsserviço web com persistência em nuvem via **Supabase (BaaS)**, operações completas de **CRUD para carteira de favoritos**, conteinerização otimizada com **Docker e Nginx sobre Alpine Linux**, e cumprimento integral de todos os requisitos do edital e das quatro **Sidequests Oficiais (SQ1 a SQ4)**.

---

## Metadados e Autor

- **Projeto:** FIIsFinder (Evolução 2)
- **Autor:** Henrique Lopes Borges de Souza
- **Matrícula:** 22612443
- **Disciplina / Contexto:** Bootcamp II — Desenvolvimento Web, Persistência e Infraestrutura Conteinerizada

### Evolução Arquitetural: Da SPA Estática à Nuvem Conteinerizada
Na Etapa 01, o FIIsFinder operava como uma SPA front-end sem estado (*stateless*), consumindo dados dinâmicos da API externa da Brapi e sem qualquer mecanismo de retenção de dados entre sessões.

Na **Etapa 02**, a arquitetura foi substancialmente reestruturada:
1. **Camada de Persistência Relacional:** Integração direta com banco de dados PostgreSQL hospedado no **Supabase**, permitindo que o investidor salve, consulte, edite notas e remova ativos favoritos de forma persistente, com segurança garantida por **Row Level Security (RLS)**.
2. **Infraestrutura Conteinerizada:** Empacotamento completo da aplicação estática em uma imagem de contêiner leve e de alto desempenho utilizando **Nginx sobre Alpine Linux**, abstraindo o ambiente operacional e garantindo total reprodutibilidade tanto em desenvolvimento quanto em produção.

---

## Identidade e Links de Infraestrutura

- **Repositório do Projeto (GitHub):** [https://github.com/owmygod12/FIIsFinder](https://github.com/owmygod12/FIIsFinder)
- **Aplicação no ar (GitHub Pages):** [https://owmygod12.github.io/FIIsFinder/](https://owmygod12.github.io/FIIsFinder/)
- **Repositório no Docker Hub:** [https://hub.docker.com/r/henriquelopescaze/fiisfinder](https://hub.docker.com/r/henriquelopescaze/fiisfinder)
- **Imagem e Namespace Docker:** `henriquelopescaze/fiisfinder`
- **Tags Disponíveis no Registry:** `1.0`, `1.1` e `latest`
- **Painel do Banco de Dados (Supabase):** [https://supabase.com/](https://supabase.com/)
- **API Externa de Cotações (Brapi):** [https://brapi.dev/](https://brapi.dev/)

---

## Persistência de Dados (Supabase / PostgreSQL)

A persistência da carteira de favoritos utiliza um banco de dados relacional PostgreSQL gerenciado no Supabase. As interações ocorrem por meio do client oficial `@supabase/supabase-js`, garantindo tipagem consistente, integridade de dados e proteção em nível de linha.

### DDL de Criação da Tabela `favoritos_fiis`

```sql
CREATE TABLE public.favoritos_fiis (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    criado_em TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    ticker TEXT NOT NULL UNIQUE,
    nome TEXT NOT NULL,
    preco NUMERIC(10, 2) NOT NULL,
    dividend_yield NUMERIC(5, 2)
);
```

### Políticas de Segurança (Row Level Security - RLS)

Para garantir acesso controlado às operações de CRUD mantendo a simplicidade de consumo da chave pública anônima (`anon key`), o RLS foi habilitado na tabela com quatro políticas explícitas:

```sql
-- 1. Habilitação do Row Level Security
ALTER TABLE public.favoritos_fiis ENABLE ROW LEVEL SECURITY;

-- 2. Política de Leitura (SELECT)
CREATE POLICY "Permitir leitura publica" 
ON public.favoritos_fiis FOR SELECT 
USING (true);

-- 3. Política de Inserção (INSERT)
CREATE POLICY "Permitir insercao publica" 
ON public.favoritos_fiis FOR INSERT 
WITH CHECK (true);

-- 4. Política de Atualização (UPDATE)
CREATE POLICY "Permitir atualizacao publica" 
ON public.favoritos_fiis FOR UPDATE 
USING (true);

-- 5. Política de Exclusão (DELETE)
CREATE POLICY "Permitir exclusao publica" 
ON public.favoritos_fiis FOR DELETE 
USING (true);
```

### Dicionário de Dados

| Coluna | Tipo de Dado | Restrições | Descrição |
| :--- | :--- | :--- | :--- |
| `id` | `BIGINT` | `PRIMARY KEY`, `GENERATED ALWAYS AS IDENTITY` | Chave primária sequencial de 64 bits gerada automaticamente pelo PostgreSQL. |
| `criado_em` | `TIMESTAMPTZ` | `NOT NULL`, `DEFAULT NOW()` | Carimbo de data e hora UTC com fuso horário da inserção do registro. |
| `ticker` | `TEXT` | `NOT NULL`, `UNIQUE` | Código de negociação do ativo na B3 (ex: `MXRF11`, `HGLG11`). Restrição `UNIQUE` impede duplicidade na carteira. |
| `nome` | `TEXT` | `NOT NULL` | Razão social ou denominação oficial do FII reportada pela administradora. |
| `preco` | `NUMERIC(10, 2)` | `NOT NULL` | Cotação mais recente em reais (BRL), suportando até 8 dígitos inteiros e 2 casas decimais. |
| `dividend_yield` | `NUMERIC(5, 2)` | `NULLABLE` | Indicador percentual anualizado de rendimentos (DY %). Permite valor nulo caso indisponível na API. |

---

## Sidequests Oficiais (SQ1 a SQ4)

### SQ1 — Otimização do Contexto de Build (`.dockerignore`)

Para otimizar o processo de compilação da imagem Docker, foi configurado o arquivo `.dockerignore` na raiz do repositório, filtrando arquivos de desenvolvimento, logs e histórico:

```text
.git
.gitignore
README.md
plan.md
docker-ps.png
*.log
.DS_Store
Thumbs.db
```

#### Justificativa Técnica:
1. **Redução Drástica do Build Context:** Quando o comando `docker build` é disparado, o Docker CLI envia recursivamente o diretório atual via socket para o Docker Daemon. O diretório `.git` armazena histórico de commits, objetos binários e referências que não têm utilidade em tempo de execução web. A exclusão reduz expressivamente os megabytes trafegados, acelerando a fase inicial do build.
2. **Minimização do Tamanho Final da Imagem (~28.8 MB):** A imagem final baseada em `nginx:alpine` atinge apenas **~28.8 MB**. O uso do `.dockerignore` impede que o comando `COPY . /usr/share/nginx/html/` injete documentações pesadas, prints (`docker-ps.png`) ou artefatos transitórios na camada de arquivos da imagem servida pelo Nginx.
3. **Segurança e Higiene Operacional:** Previne o vazamento acidental de metadados de branches, credenciais temporárias ou informações estruturais do repositório dentro do contêiner publicado publicamente.

---

### SQ2 — Versionamento e Publicação de Imagens no Docker Hub

A imagem oficial do FIIsFinder foi tagueada e publicada no repositório oficial do Docker Hub (`henriquelopescaze/fiisfinder`), contemplando as três tags requeridas:

- **`1.0`**: Versão inicial estável da aplicação conteinerizada servida via Nginx Alpine.
- **`1.1`**: Versão incremental com refinamentos de layout, cabeçalhos de cache e integração Supabase.
- **`latest`**: Ponteiro padrão para a versão de produção mais atualizada.

#### Comandos de Tagging e Push Executados:
```bash
# Tagging a partir da imagem base estável (1.0) para 1.1 e latest
docker tag henriquelopescaze/fiisfinder:1.0 henriquelopescaze/fiisfinder:1.1
docker tag henriquelopescaze/fiisfinder:1.0 henriquelopescaze/fiisfinder:latest

# Publicação (Push) de todas as tags no repositório público
docker push henriquelopescaze/fiisfinder:1.0
docker push henriquelopescaze/fiisfinder:1.1
docker push henriquelopescaze/fiisfinder:latest
```

---

### SQ3 — Documentação e Overview no Docker Hub

A página oficial do repositório no Docker Hub foi estruturada com documentação técnica completa contendo:
1. **Descrição da Aplicação:** Apresentação clara do FIIsFinder como ferramenta web para monitoramento de Fundos Imobiliários da B3 com persistência no Supabase.
2. **Comando de Execução Rápida:** Instrução pronta para consumo imediato:
   ```bash
   docker run -d -p 8080:80 --name fiisfinder henriquelopescaze/fiisfinder:latest
   ```
3. **Link do Repositório GitHub:** Link direto para o código-fonte auditável: [https://github.com/owmygod12/FIIsFinder](https://github.com/owmygod12/FIIsFinder).

---

### SQ4 — Orquestração Local e Gestão de Escala com Kubernetes

#### 1. Execução Prática de Contêineres Simultâneos
Foram instanciados dois contêineres a partir das imagens publicadas, mapeados em portas distintas no host local:

```bash
# Inicialização do Contêiner 1 na porta 8080 (tag 1.0)
docker run -d -p 8080:80 --name fiisfinder-app henriquelopescaze/fiisfinder:1.0

# Inicialização do Contêiner 2 na porta 8081 (tag latest)
docker run -d -p 8081:80 --name fiisfinder-replica henriquelopescaze/fiisfinder:latest
```

Ambos os contêineres executam de forma totalmente isolada e paralela, acessíveis respectivamente em `http://localhost:8080` e `http://localhost:8081`.

#### Evidência de Execução (`docker ps`):
Abaixo encontra-se o registro visual comprovando ambos os contêineres em execução ativa (*Up*):

![Execução simultânea de contêineres](./docker-ps.png)

---

#### 2. Análise Teórica: Gestão e Escala de 100 Contêineres via Kubernetes

Operar 2 contêineres manualmente via CLI do Docker é trivial, contudo a administração manual de **100 contêineres** em ambiente de alta disponibilidade é operacionalmente inviável pelos seguintes desafios:
- Inexistência de balanceamento de carga nativo entre múltiplos servidores físicos.
- Impossibilidade de auto-recuperação (*self-healing*) em caso de falha de hardware ou processo.
- Conflitos de portas e complexidade no roteamento de rede.
- Dificuldade em aplicar atualizações sem interrupção de serviço (*rolling updates*).

Para sanar essas limitações, utiliza-se o **Kubernetes (K8s)** como orquestrador, alicerçado em três conceitos fundamentais:

```
+-----------------------------------------------------------------------------------+
|                                  KUBERNETES CLUSTER                               |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  |                         CONTROL PLANE (MASTER)                              |  |
|  |   [API Server] <---> [etcd] <---> [Controller Manager] <---> [Scheduler]   |  |
|  +-----------------------------------------------------------------------------+  |
|                                         |                                         |
|                 +-----------------------+-----------------------+                 |
|                 |                                               |                 |
|  +-----------------------------+                 +-----------------------------+  |
|  |     WORKER NODE 01          |                 |     WORKER NODE 02          |  |
|  |  [Kubelet]   [Kube-Proxy]   |                 |  [Kubelet]   [Kube-Proxy]   |  |
|  |                             |                 |                             |  |
|  |  +-----------------------+  |                 |  +-----------------------+  |  |
|  |  |      POD (Replica)    |  |                 |  |      POD (Replica)    |  |  |
|  |  |  +-----------------+  |  |                 |  |  +-----------------+  |  |  |
|  |  |  | FIIsFinder App  |  |  |                 |  |  | FIIsFinder App  |  |  |  |
|  |  |  | (Nginx Alpine)  |  |  |                 |  |  | (Nginx Alpine)  |  |  |  |
|  |  |  +-----------------+  |  |                 |  |  +-----------------+  |  |  |
|  |  +-----------------------+  |                 |  +-----------------------+  |  |
|  |  ... até N pods             |                 |  ... até N pods             |  |
|  +-----------------------------+                 +-----------------------------+  |
+-----------------------------------------------------------------------------------+
```

##### 1. Cluster:
- O Cluster é a união lógica de servidores computacionais (físicos ou instâncias em nuvem) gerenciados de forma unificada.
- Divide-se entre o **Control Plane** (composto por API Server, etcd, Scheduler e Controller Manager) e os **Worker Nodes** (máquinas que executam as aplicações, contendo Kubelet, Kube-Proxy e o Container Runtime).
- Em uma escala de 100 contêineres, o **Scheduler** distribui automaticamente a carga computacional analisando limites de CPU e memória de cada nó, eliminando gargalos pontuais e garantindo alta disponibilidade física.

##### 2. Pod:
- O Pod é a **menor unidade atômica executável** no ecossistema Kubernetes. O Kubernetes não gerencia contêineres Docker isolados; ele instancia contêineres encapsulados dentro de Pods.
- Todos os contêineres de um Pod compartilham o mesmo endereço IP de rede, portas de escuta locais e volumes de armazenamento.
- No caso do FIIsFinder, cada Pod encapsula uma instância idêntica do Nginx servindo a SPA estática, operando como uma unidade descartável e replicável.

##### 3. Réplicas (Deployments, ReplicaSets, HPA e Self-Healing):
- **Declaração de Estado Desejado:** Através de um manifesto declarativo (`Deployment`), define-se `spec.replicas: 100`. O Kubernetes assegura continuamente que exatamente 100 instâncias estejam em execução por meio do ciclo de reconciliação (*reconciliation loop*).
- **Self-Healing (Auto-Recuperação):** Caso nós físicos falhem ou contêineres travem, o `ReplicaSet` detecta a divergência entre o estado real e o estado desejado, recriando novos Pods imediatamente em nós saudáveis, sem intervenção humana.
- **Service & Load Balancing:** Um recurso `Service` (como `LoadBalancer` ou `Ingress`) disponibiliza um único ponto de entrada para os usuários e balanceia o tráfego HTTP entre os 100 Pods ativos via round-robin.
- **Horizontal Pod Autoscaler (HPA):** Permite redimensionar dinamicamente o número de réplicas (por exemplo, reduzindo para 20 Pods na madrugada e escalando para 100 réplicas durante o horário de abertura do pregão da B3) com base na utilização de CPU, memória ou taxa de requisições.

---

## Como Executar Localmente

### Opção 1: Execução com Docker (Recomendada)

Com o Docker instalado em sua máquina, execute:

```bash
# 1. Baixar a imagem oficial diretamente do Docker Hub e iniciar o contêiner
docker run -d -p 8080:80 --name fiisfinder-app henriquelopescaze/fiisfinder:latest
```

Após a inicialização, acesse em seu navegador:
```text
http://localhost:8080
```

Para inspecionar os logs do servidor Nginx:
```bash
docker logs -f fiisfinder-app
```

Para pausar e remover o contêiner:
```bash
docker stop fiisfinder-app && docker rm fiisfinder-app
```

---

### Opção 2: Execução Estática Alternativa (Live Server)

Caso prefira executar sem o Docker, é possível servir os arquivos estáticos diretamente no navegador:

1. Clone o repositório do projeto:
   ```bash
   git clone https://github.com/owmygod12/FIIsFinder.git
   cd FIIsFinder
   ```

2. Certifique-se de que o arquivo `config.js` contenha as credenciais válidas do Supabase:
   ```javascript
   const SUPABASE_URL = "https://SEU-PROJETO.supabase.co";
   const SUPABASE_ANON_KEY = "SUA_CHAVE_ANONIMA_AQUI";
   ```

3. Abra o diretório no **VS Code**, clique com o botão direito sobre o arquivo `index.html` e selecione **"Open with Live Server"** (ou utilize qualquer servidor estático HTTP local, como `python -m http.server 8080` ou `npx serve .`).
