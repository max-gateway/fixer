from prometheus_client import Counter, Histogram

lookup_requests_total = Counter(
    "cnpj_lookup_requests_total", "Consultas de CNPJ recebidas por este serviço"
)
cnpja_calls_total = Counter(
    "cnpj_lookup_cnpja_calls_total", "Chamadas à API do CNPJá", ["status"]
)
cnpja_errors_total = Counter(
    "cnpj_lookup_cnpja_errors_total", "Erros nas chamadas ao CNPJá", ["error_type"]
)
cnpja_call_duration_seconds = Histogram(
    "cnpj_lookup_cnpja_call_duration_seconds", "Duração das chamadas ao CNPJá"
)
