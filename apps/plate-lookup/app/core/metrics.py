"""Métricas Prometheus expostas em /metrics.

Serviço é um proxy fino e stateless sobre a API Puxa Placa — quem decide se
uma placa já foi consultada antes (e portanto não deve gerar nova chamada
externa) é o Fixer core. Aqui o que importa observar é a saúde e o custo da
integração externa:
  - volume de chamadas efetivamente disparadas à API Puxa Placa
  - latência dessas chamadas
  - taxa de erro / rejeição pela API externa (inclui rate limit e placa inválida)
"""

from prometheus_client import Counter, Histogram

lookup_requests_total = Counter(
    "plate_lookup_requests_total",
    "Total de requisições recebidas em /v1/consulta/{placa}.",
)

puxa_placa_calls_total = Counter(
    "plate_lookup_puxa_placa_calls_total",
    "Chamadas efetivamente feitas à API Puxa Placa, por status do resultado.",
    ["status"],
)

puxa_placa_call_duration_seconds = Histogram(
    "plate_lookup_puxa_placa_call_duration_seconds",
    "Tempo de resposta da chamada à API Puxa Placa.",
    buckets=(0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 20.0),
)

puxa_placa_errors_total = Counter(
    "plate_lookup_puxa_placa_errors_total",
    "Falhas ao consultar a API Puxa Placa, por tipo de erro.",
    ["error_type"],
)
