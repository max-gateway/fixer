"""Cliente HTTP da API Puxa Placa (https://api.puxaplaca.app).

Serviço não guarda nenhum estado próprio: se uma placa já foi consultada
antes, é o Fixer core (apps/api, Postgres) quem sabe disso e decide não
chamar este serviço de novo. Este cliente sempre dispara a chamada real
quando invocado — não há cache/dedup aqui de propósito, pra manter uma única
fonte de verdade sobre "já consultamos essa placa".
"""

import httpx

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class PuxaPlacaError(Exception):
    """Erro ao consultar a API Puxa Placa (rede, timeout, HTTP não-2xx)."""

    def __init__(self, message: str, error_type: str) -> None:
        super().__init__(message)
        self.error_type = error_type


class PuxaPlacaClient:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient(
            base_url=settings.puxa_placa_base_url,
            timeout=settings.puxa_placa_timeout_seconds,
            headers={
                "token": settings.puxa_placa_token,
                "Accept": "application/json",
            },
        )

    async def consulta_placa(self, plate: str) -> dict:
        try:
            response = await self._client.get(f"/consulta/{plate}")
        except httpx.TimeoutException as exc:
            raise PuxaPlacaError(f"timeout consultando placa {plate}", "timeout") from exc
        except httpx.HTTPError as exc:
            raise PuxaPlacaError(f"erro de rede consultando placa {plate}", "network") from exc

        if response.status_code == 401:
            raise PuxaPlacaError("token inválido/expirado na Puxa Placa", "unauthorized")
        if response.status_code == 429:
            raise PuxaPlacaError("rate limit atingido na Puxa Placa", "rate_limited")
        if response.is_server_error:
            raise PuxaPlacaError(
                f"Puxa Placa retornou {response.status_code}", "upstream_server_error"
            )
        if response.is_client_error:
            raise PuxaPlacaError(
                f"Puxa Placa retornou {response.status_code}", "upstream_client_error"
            )

        return response.json()

    async def close(self) -> None:
        await self._client.aclose()


_client: PuxaPlacaClient | None = None


def get_client() -> PuxaPlacaClient:
    global _client
    if _client is None:
        _client = PuxaPlacaClient()
    return _client
