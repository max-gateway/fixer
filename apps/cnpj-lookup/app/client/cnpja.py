"""Cliente HTTP da API comercial do CNPJá (https://cnpja.com).

Sem estado e sem cache de propósito: cada chamada aqui consome créditos do
CNPJá. Decidir se vale reconsultar (ex.: dado com menos de 30 dias) é de quem
chama este serviço.
"""

import httpx

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class CnpjaError(Exception):
    """Erro ao consultar o CNPJá (rede, timeout, HTTP não-2xx)."""

    def __init__(self, message: str, error_type: str) -> None:
        super().__init__(message)
        self.error_type = error_type


class CnpjaClient:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient(
            base_url=settings.cnpja_base_url,
            timeout=settings.cnpja_timeout_seconds,
            headers={
                "Authorization": settings.cnpja_api_key,
                "Accept": "application/json",
            },
        )

    async def consulta_cnpj(self, cnpj: str) -> dict:
        try:
            # registrations=BR traz as Inscrições Estaduais (CCC/Sintegra) de todas as UFs.
            response = await self._client.get(
                f"/office/{cnpj}", params={"registrations": "BR"}
            )
        except httpx.TimeoutException as exc:
            raise CnpjaError(f"timeout consultando CNPJ {cnpj}", "timeout") from exc
        except httpx.HTTPError as exc:
            raise CnpjaError(f"erro de rede consultando CNPJ {cnpj}", "network") from exc

        status = response.status_code
        if status == 404:
            raise CnpjaError("CNPJ não encontrado", "not_found")
        if status in (400, 422):
            raise CnpjaError("CNPJ rejeitado pelo CNPJá", "invalid")
        if status in (401, 403):
            raise CnpjaError("chave inválida/sem permissão no CNPJá", "unauthorized")
        if status == 402:
            raise CnpjaError("créditos do CNPJá esgotados", "no_credits")
        if status == 429:
            raise CnpjaError("rate limit atingido no CNPJá", "rate_limited")
        if response.is_server_error:
            raise CnpjaError(f"CNPJá retornou {status}", "upstream_server_error")
        if response.is_client_error:
            raise CnpjaError(f"CNPJá retornou {status}", "upstream_client_error")

        return response.json()

    async def close(self) -> None:
        await self._client.aclose()


_client: CnpjaClient | None = None


def get_client() -> CnpjaClient:
    global _client
    if _client is None:
        _client = CnpjaClient()
    return _client
