# @fixer/plate-reader

Microservice de leitura de placas veiculares (OCR determinístico, sem IA generativa),
parte do monorepo **Fixer** (`apps/plate-reader`). Python, fora do workspace npm —
tem seu próprio ciclo de build/deploy (`Dockerfile` neste diretório).

## Por que existe como serviço separado

- Carga CPU/GPU-bound, com picos correlacionados a fluxo de veículos — isolado escala
  independente do Fixer core.
- Dependências nativas pesadas (OpenCV/Tesseract) não devem poluir a imagem do backend
  principal.
- Múltiplos locais/câmeras podem rodar instâncias próprias deste serviço (edge) enquanto
  o Fixer core permanece centralizado.
- Interface pequena e estável: recebe uma imagem, devolve uma placa validada.

## Filosofia de assertividade

Sem LLM, sem visão generativa, sem depender de projeto de terceiros estagnado
(o OpenALPR open-source não tem mais binding Python mantido nem build validado
em distros atuais — ver decisão abaixo). Pipeline 100% próprio, determinístico
e auditável:

1. **Detecção da região da placa** (`app/pipeline/plate_detection.py`) — contornos +
   filtro por proporção de aspecto sobre a imagem com bordas realçadas (Canny).
   Assume câmera fixa/controlada (portaria, pedágio, estacionamento).
2. **Correção de perspectiva** — warp para retângulo a partir do contorno detectado.
3. **Segmentação de caracteres** (`app/pipeline/char_ocr.py`) — componentes conectados
   na região binarizada (Otsu), filtrados por altura/proporção esperada de um
   caractere de placa BR. Componentes largos demais (caracteres colados) são
   divididos em fatias estimadas pela largura média dos demais caracteres, em vez
   de descartar a leitura inteira.
4. **OCR caractere-a-caractere via Tesseract** com whitelist `A-Z0-9` e `--psm 8`
   — espaço de decisão pequeno e fixo por posição, muito mais assertivo que OCR de
   texto livre na placa inteira.
5. **Validação/correção por regex** (`app/pipeline/plate_validation.py`) dos formatos
   de placa brasileira (Mercosul e antigo), com tabela de correção de confusões
   posicionais (`O↔0`, `I↔1`, `B↔8`, `S↔5`, ...). Quando a leitura bruta é ambígua
   entre os dois formatos, vence o que exigir **menos correções**.
6. **Votação multi-frame** (`app/pipeline/voting.py`): quando múltiplos frames do
   mesmo veículo estão disponíveis, o resultado final é decidido por votação de
   maioria caractere a caractere — reduz drasticamente falsos positivos de
   leituras isoladas.

### Por que não OpenALPR

Avaliado e descartado: o binding Python oficial (`pip install openalpr`) hoje é da
versão **comercial** (exige licença); a versão open-source não tem mais binding
Python mantido (o antigo, via SWIG, é para Python 2/3.6) e seu build só é validado
em Ubuntu 18.04 — projeto efetivamente estagnado. Optou-se por um pipeline
OpenCV + Tesseract próprio, sob controle total e sem dependência de projeto sem
manutenção.

## Fluxo

```
[Câmera/Edge] --POST /v1/recognize (imagem ou lote de frames)--> [plate-reader-service]
                                                                        |
                                                      detecção + OCR + validação + votação
                                                                        |
                                                      publica evento em fila (Redis Stream)
                                                                        |
                                                                  [Fixer core] (consumer)
```

A chamada HTTP retorna **202 Accepted** de imediato com um `request_id`; o resultado
definitivo (após votação, se aplicável) é publicado no stream `plate-reader:events` e
consumido de forma assíncrona pelo Fixer core. Isso evita que picos de múltiplas câmeras
travem quem está chamando o serviço.

O consumer real vive em [`apps/api/src/plate-events`](../api/src/plate-events)
(`PlateEventsModule`, NestJS) — consumer group Redis Streams, retry e reivindicação
de mensagens travadas. Ver o README daquele módulo para o desenho completo.

## Estrutura

```
app/
  api/          # rotas FastAPI (/v1/recognize, /healthz, /metrics)
  pipeline/     # detecção, segmentação, OCR, validação/correção, votação
  queue/        # publisher assíncrono (Redis Streams)
  core/         # config, logging, métricas Prometheus
  models/       # schemas Pydantic
tests/
```

## Rodando localmente

```bash
npm run infra:up -- --profile vision   # na raiz; compose único em infra/dev
```

Sobe o serviço (porta 8080) + Redis. Sem Tesseract instalado, o serviço cai
automaticamente em um `MockOCREngine` (ver `app/pipeline/engine.py`) para permitir
desenvolvimento sem a dependência nativa — loga isso explicitamente no startup.

O `Dockerfile` já instala `tesseract-ocr` via apt (pacote padrão em
Debian/Ubuntu atuais, ao contrário do OpenALPR) — a imagem de produção já sobe
com o motor real, sem passos extras de build.

## Observabilidade

- **Logs estruturados** (JSON, via `structlog`) em cada etapa relevante: request
  recebido, evento publicado, falhas de publicação, fallback de engine.
- **Métricas Prometheus** em `GET /metrics` (`app/core/metrics.py`):
  - `plate_reader_recognition_requests_total{location_id}` — volume por local.
  - `plate_reader_recognition_result_total{location_id,status}` — taxa de
    aceito/rejeitado/pendente, o indicador mais direto de assertividade em produção.
  - `plate_reader_recognition_duration_seconds` — tempo de processamento.
  - `plate_reader_frames_used_per_recognition` — quantos frames fecham por
    votação vs. leitura única.
  - `plate_reader_plate_event_publish_failures_total` — saúde da integração com
    a fila/Fixer core.
  - `plate_reader_ocr_engine_load_failures_total` — alerta se o motor real cair
    para o Mock em produção (não deveria acontecer fora de dev).

## Trocando o motor de OCR

O pipeline depende apenas da interface `OCREngine` (`app/pipeline/engine.py`). Implementações
disponíveis:

- `OpenCVTesseractEngine` — produção (requer `tesseract-ocr` instalado no sistema/container;
  já incluído no `Dockerfile`).
- `MockOCREngine` — dev/testes, sem dependências nativas.

Para adicionar outro motor, implemente a mesma interface e troque
`PLATE_READER_OCR_ENGINE` (`app/core/config.py`).

## Limitações conhecidas do pipeline atual

- Assume câmera fixa/controlada — não foi calibrado para ângulo/distância muito
  variáveis (ex.: app de celular apontando livremente).
- A divisão de componentes colados (`_split_merged_component` em `char_ocr.py`) é
  uma aproximação por largura média; caracteres muito distintos em largura colados
  entre si (ex.: `I` com `W`) podem ser cortados de forma desalinhada.
- Testado até aqui com imagens sintéticas (texto renderizado + leve rotação/perspectiva).
  Validação com fotos reais da câmera de produção é o próximo passo antes de calibrar
  os thresholds (`_MIN_CONFIDENCE_SINGLE_FRAME`, faixas de aspect ratio) para o
  ambiente real.
