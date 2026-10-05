# @fixer/plate-lookup

Microservice de consulta de dados veiculares por placa, via API **Puxa Placa**
(`https://api.puxaplaca.app`), parte do monorepo **Fixer** (`apps/plate-lookup`).
Python, fora do workspace npm — tem seu próprio ciclo de build/deploy
(`Dockerfile` neste diretório). Estrutura análoga ao
[`apps/plate-reader`](../plate-reader), adaptada para o formato deste serviço.

## Por que existe como serviço separado

- Isola a integração/credencial com um fornecedor de terceiros (token da Puxa
  Placa) do backend principal.
- Interface pequena e estável: recebe uma placa, devolve os dados do veículo.
- Pode ter seu próprio limite de taxa/retry sem acoplar esse comportamento ao
  Fixer core.

## Diferença importante em relação ao plate-reader

O `plate-reader` é assíncrono (202 Accepted + fila Redis) porque o
processamento de OCR é pesado e pode precisar de votação multi-frame. Este
serviço **não é isso**: é uma chamada HTTP síncrona e rápida a uma API
terceira, então responde **200 direto** com o resultado, sem fila.

## Particularidade: não há cache/dedup aqui

Este serviço é **stateless** e **sempre dispara uma chamada real** (e paga)
à API Puxa Placa quando chamado — ele não sabe e não decide se aquela placa
já foi consultada antes.

Essa decisão é do **Fixer core** (`apps/api`, NestJS/Postgres): antes de
chamar este microservice, o core deve checar se já existe uma consulta salva
para a placa e, se sim, reaproveitar o resultado salvo **sem** chamar este
serviço de novo. Placa e dados do veículo não mudam, então uma vez consultada
a placa não deveria precisar de nova chamada externa — mas essa regra de
histórico/reaproveitamento vive no core, não aqui.

```
[Fixer core] --já tem essa placa no Postgres?--
      |                                        |
     sim                                      não
      |                                        |
 retorna do banco               GET /v1/consulta/:placa (este serviço)
                                                 |
                                    chama API Puxa Placa (pago)
                                                 |
                                    core salva o resultado no Postgres
```

## Endpoints

- `GET /v1/consulta/{placa}` — consulta completa do veículo (dados básicos,
  chassi, renavam, roubo/furto, FIPE). Aceita placa Mercosul (`ABC1D23`) ou
  formato antigo (`ABC1234`); normaliza (remove hífen/espaço, uppercase) antes
  de validar e chamar a API externa. Retorna `422` se o formato for inválido
  antes de gastar uma chamada.
- `GET /healthz`
- `GET /metrics` — métricas Prometheus.

Endpoints de tabela FIPE isolada (marcas/modelos/anos/valor) da Puxa Placa
**não** foram incluídos nesta primeira versão — o único endpoint implementado
é a consulta de veículo por placa, que já retorna os dados de FIPE mais
recentes do veículo dentro do bloco `fipe`.

## Configuração

Variáveis de ambiente (prefixo `PLATE_LOOKUP_`, ver `app/core/config.py`):

| Variável | Descrição |
|---|---|
| `PLATE_LOOKUP_PUXA_PLACA_TOKEN` | Token de autenticação da Puxa Placa (header `token`). **Nunca commitar.** |
| `PLATE_LOOKUP_PUXA_PLACA_BASE_URL` | Base URL da API (default `https://api.puxaplaca.app/v2`). |
| `PLATE_LOOKUP_PUXA_PLACA_TIMEOUT_SECONDS` | Timeout da chamada HTTP (default `10`). |
| `PLATE_LOOKUP_LOG_LEVEL` | Nível de log (default `INFO`). |

Copie `.env.example` para `.env` e preencha o token localmente. O `.env` está
no `.gitignore` — nunca deve ser comitado.

## Rodando localmente

```bash
cp .env.example .env   # preencha PLATE_LOOKUP_PUXA_PLACA_TOKEN
npm run infra:up   # na raiz; compose único em infra/dev
```

Sobe o serviço na porta 8081.

## Observabilidade

- **Logs estruturados** (JSON, via `structlog`): request recebido, chamada à
  Puxa Placa concluída/falha, formato de placa inválido.
- **Métricas Prometheus** em `GET /metrics` (`app/core/metrics.py`):
  - `plate_lookup_requests_total` — volume de requisições recebidas.
  - `plate_lookup_puxa_placa_calls_total{status}` — chamadas efetivamente
    disparadas à API externa, ok vs. erro (sinal direto de custo, já que cada
    chamada é paga).
  - `plate_lookup_puxa_placa_call_duration_seconds` — latência da API externa.
  - `plate_lookup_puxa_placa_errors_total{error_type}` — falhas por tipo
    (timeout, rate limit, erro de rede, erro do upstream).

## Estrutura

```
app/
  api/       # rotas FastAPI (/v1/consulta/{placa}, /healthz, /metrics)
  client/    # cliente HTTP da Puxa Placa + validação de formato de placa
  core/      # config, logging, métricas Prometheus
  models/    # schemas Pydantic (espelham o payload da Puxa Placa v2)
tests/
```

## Erros

Erros da API Puxa Placa são traduzidos para status HTTP deste serviço:

| Erro upstream | Status retornado |
|---|---|
| Token inválido/expirado | 502 |
| Rate limit (429) | 429 |
| Erro 4xx/5xx do upstream | 502 |
| Timeout | 504 |
| Erro de rede | 502 |
| Formato de placa inválido (antes de chamar o upstream) | 422 |
