import time

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from app.core.config import settings
from app.client.plate_validation import is_valid_plate, normalize_plate
from app.client.puxa_placa import PuxaPlacaClient, PuxaPlacaError, get_client
from app.core.logging import get_logger
from app.core.metrics import (
    lookup_requests_total,
    puxa_placa_call_duration_seconds,
    puxa_placa_calls_total,
    puxa_placa_errors_total,
)
from app.models.schemas import PlateLookupResult

logger = get_logger(__name__)
router = APIRouter()

# Mapeia o tipo de erro do cliente Puxa Placa para o status HTTP devolvido
# pelo nosso serviço.
_ERROR_TYPE_TO_STATUS = {
    "unauthorized": 502,
    "rate_limited": 429,
    "upstream_server_error": 502,
    "upstream_client_error": 502,
    "timeout": 504,
    "network": 502,
}


@router.get("/v1/consulta/{placa}", response_model=PlateLookupResult)
async def consulta_placa(
    placa: str,
    client: PuxaPlacaClient = Depends(get_client),
) -> PlateLookupResult:
    """Consulta dados completos de um veículo pela placa.

    Este serviço não tem estado próprio: cada chamada aqui dispara uma
    chamada real (e paga) à API Puxa Placa. Decidir se a placa já foi
    consultada antes — e portanto se vale reaproveitar um resultado salvo em
    vez de chamar esta rota — é responsabilidade de quem chama (Fixer core).
    """
    normalized = normalize_plate(placa)
    lookup_requests_total.inc()

    if not is_valid_plate(normalized):
        logger.info("plate_lookup_invalid_format", placa=placa)
        raise HTTPException(status_code=422, detail="Formato de placa inválido.")

    logger.info("plate_lookup_request_received", placa=normalized)

    started_at = time.monotonic()
    try:
        raw = await client.consulta_placa(normalized)
    except PuxaPlacaError as exc:
        puxa_placa_call_duration_seconds.observe(time.monotonic() - started_at)
        puxa_placa_errors_total.labels(error_type=exc.error_type).inc()
        puxa_placa_calls_total.labels(status="error").inc()
        logger.warning(
            "puxa_placa_call_failed",
            placa=normalized,
            error_type=exc.error_type,
            error=str(exc),
        )
        status_code = _ERROR_TYPE_TO_STATUS.get(exc.error_type, 502)
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc

    puxa_placa_call_duration_seconds.observe(time.monotonic() - started_at)
    puxa_placa_calls_total.labels(status="ok").inc()

    result = PlateLookupResult.model_validate(raw)
    logger.info(
        "plate_lookup_completed",
        placa=normalized,
        error=result.error,
        marca=result.basico.dados.marca if result.basico and result.basico.dados else None,
        modelo=result.basico.dados.modelo if result.basico and result.basico.dados else None,
    )
    return result


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz")
async def readyz() -> dict[str, str]:
    """Readiness: só fica pronto com token configurado (não consulta a API paga)."""
    if not settings.puxa_placa_token:
        raise HTTPException(status_code=503, detail="token da Puxa Placa não configurado")
    return {"status": "ready"}


@router.get("/metrics")
async def metrics() -> Response:
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
