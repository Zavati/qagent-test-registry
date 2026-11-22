# UI-TD-2 — Registry de Test Designs UI

Pacote **0.6.0**, extensão aditiva do Registry existente. Não há outro serviço de versões,
endpoint de API fictício, chamada de IA ou execução de navegador neste componente.

## Contrato e responsabilidades

O Registry aceita somente `outcome: COMPILED` de `qagent.ui-test-design-compilation.v1`,
com compilador `qagent_ui_test_design_compiler_v1`, specification `qagent.ui-test-design.v1`
e `executionPerformed: false`. `NO_DESIGN` continua sendo um resultado do job e não cria
uma versão vazia. REPLAY e LIVE são os dois modos previstos na especificação.

A validação verifica o escopo em três dimensões, a fonte imutável, o SHA-256 da specification
canônica, o resumo derivado, referências/hashes de artefatos, checkpoints, locators,
operadores/parameters finitos, matching e consumo sem fallback. Não aceita JavaScript
executável, bindings não suportados, campos desconhecidos ou alegações de PASS.
Valores observados podem conter texto semelhante a código; eles continuam sendo dados,
sem operação de avaliação ou execução. A canonicalização preserva ordem significativa
de arrays, ordena chaves e recusa números não finitos, propriedades inseguras e Unicode inválido.

O guard portátil `src/validation/uiTestDesignContract.js` é sincronizado por conteúdo com
o compilador. A fixture de teste veio da execução real desse compilador sobre um bundle
de ensaio validado; não é evidência de execução de UI.

O Registry verifica consistência das referências recebidas, sem buscar novamente todos
os artefatos. O Gateway autenticado verifica acesso atual à fonte no qagent-ui antes de
publicar e antes de devolver uma leitura ao usuário. A imutabilidade da versão não ignora
revogação na origem. Bytes brutos continuam no Observation/qagent-ui.

## Rotas internas

Todas as rotas abaixo usam Service Binding e a assinatura
`qagent.project-test-generation.internal.v1`, igual à do Gateway/Orchestrator:

```text
X-QAgent-Organization-Id
X-QAgent-Project-Id
X-QAgent-Test-Generation-Timestamp
X-QAgent-Test-Generation-Signature
```

O HMAC cobre método, path, query canônica, organização, projeto, timestamp e hash do body.
O ambiente vem do body/query assinado e deve coincidir com a fonte e a specification.
O body tem leitura limitada e é autenticado antes de ser interpretado como JSON. Chaves
JSON ou parâmetros de query duplicados são recusados. As rotas API anteriores não mudam.

### Publicação

`POST /v1/test-registry/ui-test-designs/versions`

```json
{
  "organizationId": "org_example",
  "projectId": "prj_example",
  "environmentId": "env_example",
  "generationRequestId": "uitdg_item_stable_id",
  "compilation": { "...": "envelope integral do compilador" },
  "createdBy": "usr_example",
  "createdByAccountId": "acc_example"
}
```

`createdBy` e `createdByAccountId` são opcionais; ausentes equivalem a null. O exemplo é
esquemático: `compilation` deve conter o contrato integral, não o objeto abreviado acima.
Resposta direta, sem wrapper `data`:

```json
{
  "status": "persisted",
  "testDesignId": "uitd_<sha256>",
  "testDesignVersionId": "uitdv_<sha256>",
  "version": 1,
  "contentHash": "<specificationHash>",
  "domain": "UI"
}
```

Uma versão nova retorna HTTP 201; reutilização retorna HTTP 200 e `status: reused`.
`contentHash` é exatamente o SHA-256 canônico de `compilation.specification`.

A identidade lógica usa organização/projeto/ambiente/captura. Outra política ou conteúdo
compilado da mesma captura cria uma versão sequencial nova. A identidade da versão também
inclui o hash da specification. Outra captura possui raiz própria; agrupamentos futuros
não são inferidos por URL ou semelhança.

O mesmo `generationRequestId` no mesmo escopo deve preservar compilação e ator. Retry
reutiliza a versão existente; conteúdo ou proveniência incompatíveis retornam HTTP 409
`UI_TEST_DESIGN_IDEMPOTENCY_CONFLICT`. Uma nova operação com conteúdo idêntico reutiliza a
versão e registra uma linha própria de proveniência. Voltar a publicar conteúdo antigo
não rebaixa o ponteiro latest de uma raiz que já tem versão posterior.

Raiz, versão, operação e ponteiro latest são gravados em um batch D1 atômico. Um conflito
concorrente de operação desfaz a versão candidata perdedora. Confirmação perdida é
reconciliada pela operação e seus hashes; um retry não cria outra versão. As tabelas de
versões e operações possuem triggers que impedem UPDATE/DELETE.

### Leitura exata

`GET /v1/test-registry/ui-test-designs/versions/:versionId?organizationId=...&projectId=...&environmentId=...`

Retorna diretamente os IDs, versão, hash, domínio, fonte, resumo, `createdAt`, compilação
integral e `executionPerformed: false`. Ausência e versão de outro escopo retornam o mesmo
404. O Registry verifica novamente o hash da compilação armazenada e seu contrato.

### Listagem

`GET /v1/test-registry/projects/:projectId/ui-test-designs?organizationId=...&environmentId=...&cursor=...&limit=20`

Retorna `{domain:'UI',scope,items,nextCursor}`. Cada item contém IDs, versão, hash, domínio,
fonte, resumo e data; os bytes da specification são carregados pela leitura exata.
São listadas versões imutáveis, da inserção mais recente para a mais antiga. O limite é
1–50, com default 20. Há também orçamento de bytes da página; quando ele reduz a quantidade,
`nextCursor` preserva a continuidade.

O cursor fixa o maior número de inserção da primeira página e o escopo. Versões publicadas
depois não entram silenciosamente na paginação iniciada. Isto é paginação de versões do
Registry, não um inventário global do UI Catalog ou snapshot de todas as observações.

## Limites e schema

- Compilação canônica integral: **768 KiB**, sem truncar dependências.
- Body de append: **1 MiB**; resumo: **64 KiB**.
- Listagem: metadados limitados a aproximadamente **512 KiB**, com cursor quando necessário.
- IDs de fonte seguem o contrato UI; IDs de publicação são estáveis por escopo/conteúdo.

O limite da compilação mantém a linha D1 abaixo do limite de 2.000.000 bytes para
string/BLOB/linha, inclusive com metadados. Fonte primária:
[Cloudflare D1 — Limits](https://developers.cloudflare.com/d1/platform/limits/).

A migration `0007_ui_test_design_registry.sql` cria `ui_test_designs`,
`ui_test_design_versions` e `ui_test_design_operations`, seus índices e triggers.
Não altera tabelas, dados, schemas, rotas ou validação do domínio API.

## Aplicação

No repositório `qagent-test-registry`:

```bash
npm ci
npm run test:ui-td2
npm run check:deploy-config
npx wrangler d1 migrations apply TEST_REGISTRY_DB --remote
npx wrangler secret put TEST_GENERATION_INTERNAL_HMAC_SECRET
npm run deploy
```

Configure o mesmo segredo interno já usado pelo Gateway/Orchestrator. Não crie um valor
diferente somente no Registry; não coloque o segredo no código ou no Console. A migration
é aditiva e deve preceder a implantação das novas rotas. Se o pacote não incluir lockfile,
use `npm install` no lugar de `npm ci`, preservando o lockfile existente quando aplicável.

## Verificação incluída

`npm run test:ui-td2` usa SQLite real para verificar fixture do compilador, hashes/escopo,
versões imutáveis, reutilização entre operações, conflito, corrida de publicação,
confirmação perdida, paginação com publicações concorrentes, HMAC antes de parse, limites,
ausência de execução e compatibilidade API. `npm test` mantém os testes API anteriores.

Essas verificações são locais. Migration aplicada em D1 remoto, secrets configurados,
deploy e smoke integrado precisam de evidência própria; os testes locais não declaram
essas etapas realizadas.

### Resultado local deste corte

- `node --test test/ui-test-design-registry.test.mjs`: **11/11 passaram**, incluindo SQLite,
  uma disputa real de duas publicações e confirmação perdida após COMMIT.
- `npm run check:deploy-config`: **passou**.
- `npm test`: **255/259 passaram**. Quatro falhas legadas permanecem visíveis; a suíte
  geral não é apresentada como aprovada.

As mesmas quatro falhas foram reproduzidas sem qualquer alteração no ZIP base
`qagent-test-registry-08.1.8-FIX-4.zip`, executando somente:

```bash
node --test test/scenario-lifecycle-08.1.6-fix3-1.test.mjs test/structured-readiness-integration-08.1.7-a.test.mjs
```

São dois casos de lifecycle (`409`/`400` versus `201` esperado) e dois casos de readiness
legado (`BLOCKED` versus `READY`). Esse recorte da base teve 16 aprovações e as mesmas
quatro falhas. Nenhum teste, schema, validador ou runtime API foi relaxado para aprovar a
extensão UI. `check:ui-td2` continua incluindo a suíte geral e, portanto, também reporta
essas falhas enquanto o problema legado não for tratado em seu próprio escopo.
