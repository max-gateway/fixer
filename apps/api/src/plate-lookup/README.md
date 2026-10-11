# PlateLookupModule

Expõe `GET /vehicles/plate-lookup/:placa`, que consulta dados completos de um
veículo pela placa via o microservice
[`apps/plate-lookup`](../../../plate-lookup) (Python) — que por sua vez chama
a API **Puxa Placa**. Este módulo (core) nunca fala com a Puxa Placa
diretamente nem guarda o token dela; isso fica isolado no microservice.

## Regra central: consulta só uma vez por placa

Cada chamada ao microservice `apps/plate-lookup` dispara uma chamada real (e
paga) à API Puxa Placa. Placa e dados cadastrais do veículo não mudam, então
o resultado é tratado como definitivo — **não há reconsulta**, nem por TTL.

Fluxo de `PlateLookupService.lookup()`:

```
1. Normaliza a placa (remove hífen/espaço, uppercase) e valida o formato.
2. SELECT PlateLookup WHERE plate = :placa
     existe?  -> devolve o registro salvo (cached: true), NÃO chama o microservice.
     não existe? -> chama apps/plate-lookup (GET /v1/consulta/:placa)
                    -> salva o resultado em PlateLookup (upsert)
                    -> devolve (cached: false)
```

A tabela `PlateLookup` (`packages/db/prisma/schema.prisma`) é a fonte de
verdade de "essa placa já foi consultada" — guarda o payload completo
(`rawResponse`) e alguns campos extraídos (`brand`, `model`, `year`) só para
facilitar consulta/index sem precisar parsear o JSON.

## Resposta crua (nada é descartado)

`rawResponse` guarda o JSON **exatamente como a Puxa Placa devolveu**: o
microservice o repassa sem filtrar e o core não o reescreve. A consulta é paga
e nunca expira, então campos que o schema ainda não conhece (motor,
cilindradas, potência, etc.) são preservados. `schema.ts` é só uma visão
tipada e tolerante para leitura (`.passthrough()`, números-string
convertidos); para expor um campo novo basta declará-lo ali.

Linhas gravadas antes dessa mudança foram salvas filtradas e não têm os campos
extras; só uma nova consulta (paga) os traz — em dev, apague a linha da placa.

## Por que não usar o model `Vehicle` existente

`Vehicle` é o cadastro operacional da oficina (dono edita `mileage`, etc.) e
só existe quando há um Customer/Service Order associado. `PlateLookup` é
puramente o histórico de consultas à API externa — desacoplado de
`Vehicle` de propósito. Enriquecer `Vehicle` a partir de um `PlateLookup` é
uma decisão de produto que pode vir depois; hoje não é feita automaticamente.

## Erros

- Placa em formato inválido → `400 Bad Request` (nunca chega a chamar o
  microservice).
- Microservice indisponível / timeout → `502 Bad Gateway`.
- Microservice retorna erro (ex.: rate limit da Puxa Placa) → o mesmo status
  HTTP é propagado.

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PLATE_LOOKUP_SERVICE_URL` | `http://localhost:8081` | Base URL do microservice `apps/plate-lookup` |
| `PLATE_LOOKUP_SERVICE_TIMEOUT_MS` | `15000` | Timeout da chamada ao microservice |
