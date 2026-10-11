import time

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from app.client.cnpj_validation import is_valid_cnpj, normalize_cnpj
from app.client.cnpja import CnpjaClient, CnpjaError, get_client
from app.client.mapping import to_empresa
from app.core.config import settings
from app.core.logging import get_logger
from app.core.metrics import (
    cnpja_call_duration_seconds,
    cnpja_calls_total,
    cnpja_errors_total,
    lookup_requests_total,
)
from app.models.schemas import EmpresaCnpj

logger = get_logger(__name__)
router = APIRouter()

# Mapeia o tipo de erro do cliente CNPJá para o status HTTP devolvido por este serviço.
_ERROR_TYPE_TO_STATUS = {
    "not_found": 404,
    "invalid": 422,
    "unauthorized": 502,
    "no_credits": 502,
    "rate_limited": 429,
    "upstream_server_error": 502,
    "upstream_client_error": 502,
    "timeout": 504,
    "network": 502,
}


@router.get("/v1/cnpj/{cnpj}", response_model=EmpresaCnpj)
async def consulta_cnpj(
    cnpj: str,
    client: CnpjaClient = Depends(get_client),
) -> EmpresaCnpj:
    """Consulta dados cadastrais (Receita) e Inscrições Estaduais (CCC) de um CNPJ.

    Aceita CNPJ com ou sem máscara, numérico ou alfanumérico. Sem estado: cada
    chamada consome créditos do CNPJá, então quem chama decide se reaproveita
    um resultado já salvo.
    """
    normalized = normalize_cnpj(cnpj)
    lookup_requests_total.inc()

    if not is_valid_cnpj(normalized):
        logger.info("cnpj_lookup_invalid", cnpj=cnpj)
        raise HTTPException(status_code=422, detail="CNPJ inválido.")

    logger.info("cnpj_lookup_request_received", cnpj=normalized)

    started_at = time.monotonic()
    try:
        raw = await client.consulta_cnpj(normalized)
    except CnpjaError as exc:
        cnpja_call_duration_seconds.observe(time.monotonic() - started_at)
        cnpja_errors_total.labels(error_type=exc.error_type).inc()
        cnpja_calls_total.labels(status="error").inc()
        logger.warning(
            "cnpja_call_failed", cnpj=normalized, error_type=exc.error_type, error=str(exc)
        )
        status_code = _ERROR_TYPE_TO_STATUS.get(exc.error_type, 502)
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc

    cnpja_call_duration_seconds.observe(time.monotonic() - started_at)
    cnpja_calls_total.labels(status="ok").inc()

    empresa = to_empresa(raw, normalized)
    logger.info(
        "cnpj_lookup_completed",
        cnpj=normalized,
        situacao=empresa.situacao,
        ies=len(empresa.inscricoes_estaduais),
    )
    return empresa


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz")
async def readyz() -> dict[str, str]:
    """Readiness: só fica pronto com a chave configurada (não consulta a API paga)."""
    if not settings.cnpja_api_key:
        raise HTTPException(status_code=503, detail="chave do CNPJá não configurada")
    return {"status": "ready"}


@router.get("/metrics")
async def metrics() -> Response:
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
