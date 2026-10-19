# ISS e código municipal pela NFS-e Nacional

Status: **rascunho para revisão; depende de teste na produção restrita** · Escopo: novo cliente `apps/api/src/fiscal-autofill/nfse`, reaproveitando o TLS mútuo de `fiscal-inbound` · Relacionadas: [fiscal-autofill.md](fiscal-autofill.md), [tax-rules.md](tax-rules.md), [dfe-gateway.md](dfe-gateway.md)

## 1. Por quê

`issRate` e `municipalServiceCode` dependem da lei de cada município e do serviço prestado, e hoje são digitados à mão (a tela marca `missingTax` quando faltam). O Sistema Nacional NFS-e tem uma API de **parâmetros municipais**: o município cadastra ali, para cada serviço, a alíquota e as regras que a Sefin Nacional usa para validar a nota. É a mesma fonte que vai validar a NFS-e da oficina, então é a fonte certa.

## 2. API

Do "Guia para utilização das APIs do Emissor Público Nacional" (gov.br/nfse):

| Rota | O que devolve |
|---|---|
| `GET /parametros_municipais/{codigoMunicipio}/convenio` | Parâmetros do convênio do município (se aderiu e como) |
| `GET /parametros_municipais/{codigoMunicipio}/{codigoServico}` | Alíquotas, regimes especiais de tributação e deduções/reduções do subitem da lista de serviços |
| `GET /parametros_municipais/{codigoMunicipio}/{CPF/CNPJ}` | Retenções que o contribuinte deve recolher no município; benefícios municipais a que tem direito |

- `codigoMunicipio` = IBGE de 7 dígitos (`TenantFiscalSettings.municipalityIbge`, já preenchido).
- `codigoServico` = código de tributação nacional, que vem do item da LC 116 ([fiscal-autofill.md](fiscal-autofill.md) §5.1).
- Autenticação: TLS mútuo com certificado ICP-Brasil, como as outras APIs da Sefin Nacional. **O e-CNPJ A1 do tenant serve**.
- Base: Sefin Nacional (produção) e produção restrita para testes (Swagger em `adn.producaorestrita.nfse.gov.br/contribuintes/docs`). **URLs exatas, formato da resposta e versão da rota a confirmar no Swagger.**
- A v1.1 do guia acrescentou consulta de alíquotas de ISS **por trecho e data** (participação de cada município, alíquota base, efetiva municipal e efetiva total). Ela serve à transição do ISS para o IBS e fica fora da v1 desta spec.

## 3. Fluxo

```
municipalityIbge + cTribNac
  1. GET …/{ibge}/convenio
       não conveniado ou sem parametrização → fallback (§5)
  2. GET …/{ibge}/{cTribNac}
       → alíquota vigente hoje            → issRate              (NFSE_PARAMETROS / OFICIAL)
       → código de tributação municipal   → municipalServiceCode (se o município usar)
       → regimes especiais / deduções     → evidence (mostrados na tela, não usados no cálculo da v1)
  3. GET …/{ibge}/{CNPJ}
       → retenções e benefícios do próprio contribuinte → evidence + aviso
```

- **Alíquota com vigência.** A resposta deve trazer vigência; gravar a vigente na data da consulta, e a próxima, se já publicada, em `evidence` (a atualização mensal troca na data).
- **Benefício do contribuinte** (passo 3) com alíquota diferente da geral: usar a do benefício e dizer isso na tela.
- **Optante do Simples:** a alíquota municipal **não** é o ISS que ele paga. O ISS do Simples sai do Anexo III com a RBT12 ([fiscal-autofill.md](fiscal-autofill.md) §9). Para optante, a alíquota municipal fica em `evidence` (serve para retenção e para quem é desenquadrado), e `issRate` vem do Anexo III quando a tabela `simples-servicos` existir.
- **Faixa válida:** o ISS vai de 2% a 5% (LC 116, art. 8º e 8º-A). Valor fora disso não é gravado: vira `SEM_DADO` com a resposta no log, porque é mais provável erro de parametrização do município do que lei. O schema atual (`issRate` > 0 e ≤ 5) continua valendo.

## 4. Implementação

- Cliente HTTP com o mesmo agente TLS de `fiscal-inbound/sefaz` (cadeia ICP-Brasil, sem `rejectUnauthorized: false`) e o certificado decifrado pelo `secret-box` só durante a chamada. No modo gateway, a chamada sai do `dfe-gateway`, que já tem o certificado: rota nova lá, `GET /v1/nfse/parametros/{ibge}/{codigo}`, sem regra de negócio (D8 de [dfe-gateway.md](dfe-gateway.md)).
- Os parâmetros são do **município**, não da empresa: cache por `(ibge, cTribNac)` por 24 h na plataforma, para que N oficinas do mesmo município não repitam a consulta. O passo 3 (contribuinte) não vai para o cache.
- Timeout de 10 s, 2 tentativas com backoff. Falha = passo `FALHOU` no job, sem apagar o valor anterior.
- Fixtures da produção restrita, gravadas na fase de prova, para os testes.

## 5. Fallback

Quando o município não responde, não é conveniado ou não parametrizou o serviço:

1. **Tabela curada em `packages/tax-rules`** (`iss-municipal`), só para os municípios dos clientes, com lei municipal como fonte, vigência e `verify:sources` como as outras. Começa por PE: Recife, Jaboatão dos Guararapes, Olinda, Paulista, Caruaru, Petrolina (**alíquotas a levantar na legislação de cada um**; nada é preenchido sem fonte). Proveniência `TAX_RULES_DEFAULT` / `OFICIAL` se a lei foi lida, ou `ESTIMADO`.
2. Sem tabela: pergunta guiada com o que se sabe ("Serviço 14.01 em Recife. Qual alíquota de ISS o seu contador usa?").

O código de tributação municipal não tem fallback em tabela: muitos municípios não o usam, e quem usa publica tabela própria. Fica a pergunta, e a NFS-e Nacional aceita a nota sem ele quando o município não exige.

## 6. Consentimento

A consulta só lê parâmetros públicos do município e as retenções e benefícios da própria empresa. Não lê declaração nem pagamento, então não depende do consentimento de dados da Receita ([fiscal-autofill.md](fiscal-autofill.md) §7). A tela do certificado informa que ele é usado para "consultar as regras de ISS da sua prefeitura", e cada consulta vai para `FiscalAuditLog`.

## 7. Fase de prova

Na produção restrita e depois em produção, com o certificado de um cliente:

1. Confirmar URLs, versão e formato das três rotas, e que o e-CNPJ do contribuinte é aceito (e não só o de município).
2. Consultar os municípios dos clientes atuais com 14.01.01 e anotar: conveniado?, alíquota, vigência, código municipal. Isso define o tamanho do fallback (§5).
3. Confirmar se a resposta do serviço traz vigência e como vem a alíquota (percentual ou fração).

Saída: esta spec atualizada e a lista de municípios que precisam de tabela curada.

## 8. Fontes

- [Guia das APIs do Emissor Público Nacional, v1.2, out/2025 (gov.br/nfse)](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-emissor-publico-api-sistema-nacional-nfs-e-v1-2-out2025.pdf): rotas de parâmetros municipais, lido em 2026-10-19.
- [Guia do Painel Administrativo Municipal, v1.2 (gov.br/nfse)](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/guia-do-painel-administrativo-municipal-nfs-e-v1-2-out2025.pdf): o município parametriza alíquota, deduções e código municipal por serviço.
- [Contábeis: nova consulta de ISS por trecho](https://www.contabeis.com.br/noticias/78032/nfs-e-nacional-atualiza-apis-e-inclui-nova-consulta-do-iss/).
- [LC 116/2003 (Planalto)](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm): lista de serviços (item 14.01) e alíquotas mínima e máxima.
