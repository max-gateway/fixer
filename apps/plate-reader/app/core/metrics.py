"""Métricas Prometheus expostas em /metrics.

Cobrem os sinais operacionais que mais importam para um serviço de OCR
determinístico rodando atrás de múltiplas câmeras/locais:
  - taxa de aceitação vs. rejeição da leitura (indicador direto de assertividade)
  - tempo de processamento por request (detecção + segmentação + OCR + votação)
  - quantos frames em média fecham por votação vs. leitura única
  - falhas de publicação na fila (sinal de saúde da integração com o Fixer core)
"""

from prometheus_client import Counter, Histogram

recognition_requests_total = Counter(
    "plate_reader_recognition_requests_total",
    "Total de requisições recebidas em /v1/recognize.",
    ["location_id"],
)

recognition_result_total = Counter(
    "plate_reader_recognition_result_total",
    "Resultado final de cada reconhecimento processado, por status.",
    ["location_id", "status"],
)

recognition_duration_seconds = Histogram(
    "plate_reader_recognition_duration_seconds",
    "Tempo total de processamento de um request (detecção + OCR + validação + votação).",
    buckets=(0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)

frames_used_per_recognition = Histogram(
    "plate_reader_frames_used_per_recognition",
    "Número de frames usados para fechar um resultado (1 = frame único, >1 = votação).",
    buckets=(1, 2, 3, 5, 8, 13),
)

plate_event_publish_failures_total = Counter(
    "plate_reader_plate_event_publish_failures_total",
    "Falhas ao publicar um evento de leitura na fila (Redis Stream).",
)

ocr_engine_load_failures_total = Counter(
    "plate_reader_ocr_engine_load_failures_total",
    "Vezes que o motor de OCR real falhou ao carregar, caindo para o MockOCREngine.",
)
