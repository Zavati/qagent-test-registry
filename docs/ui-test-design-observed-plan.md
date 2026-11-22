# UI-TD-3 — plano observado por referências

Novos lotes usam `qagent_ui_test_design_compiler_v2`, `qagent.ui-test-design-compilation.v2` e `qagent.ui-test-design.v2`. O perfil v2 tem `coveragePolicy: ALL_OBSERVED`; não recebe cotas globais de checks, nós ou bytes observados. A evidência permanece no bundle imutável, identificado por escopo, captura, versão, source hash e manifest hash. O contrato do plano usa regras finitas, versionadas, e seleção integral das seções.

O limite de transporte continua protegendo cada resposta/registro. Ele limita o pequeno contrato por referências; a quantidade total de evidência não é copiada para esse contrato. A leitura detalhada avança por páginas e não produz truncamento global da observação.

## Compatibilidade

Versões e jobs v1 continuam aceitos explicitamente. O compilador e o perfil salvos em cada job são usados no callback e nas tentativas subsequentes. Não se reescrevem candidatos, versões ou resultados históricos. Repetir uma operação com parâmetros diferentes permanece conflito; para gerar um plano v2 a partir de uma fonte antiga, criar uma nova operação. Publicações repetidas reconciliam os mesmos bytes/hash e não criam versões duplicadas.

## Cobertura e resultados

`validationUnitsPlanned` indica unidades de evidência incluídas no plano, não assertions já executadas. `validationUnitsExecuted` e `checksGenerated` são zero neste contrato de referências. Checkpoints instáveis, fixtures indisponíveis e comparadores pendentes não são removidos nem promovidos a PASS. O plano exige percorrer todas as seções e o conteúdo de todos os artefatos; pendências impedem uma conclusão integral de sucesso.

A integridade dos artefatos declarada no plano corresponde à verificação realizada na montagem do bundle. A compilação v2 verifica o manifesto e a origem; os blobs não são todos baixados novamente. A leitura do conteúdo de um artefato revalida seus bytes e SHA256. Nenhum desses serviços executa o Browser Runner ou chama IA para gerar o plano.

## Implantação

Não há nova migration, secret ou binding para este incremento. Atualizar os consumidores e qagent-ui antes de habilitar o novo default no Gateway. Manter as configurações Wrangler e os segredos já utilizados no ambiente. O Console anterior deve ser atualizado para apresentar o novo contrato; versões v1 permanecem legíveis.

## Registry

O guard v1 permanece integral. O novo guard portátil valida o contrato v2 fechado, todas as seções, a cobertura declarada, os dois modos e ausência de execução. O Registry confere os hashes, o escopo e a igualdade entre resumo e specification antes do append imutável. Fixtures inline são verificadas pelo caminho v1; v2 guarda somente referências e o acesso às páginas é mediado pelo Gateway/qagent-ui.

O mesmo testDesign pode conservar versões v1 e v2. A chave de operação e os hashes continuam garantindo idempotência e tratamento de ACK perdido.

Verificação focal: `npm run test:ui-td3`.
