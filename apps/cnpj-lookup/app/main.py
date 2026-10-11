from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes import router
from app.client.cnpja import get_client
from app.core.config import settings
from app.core.logging import configure_logging, get_logger

configure_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail fast: sem chave toda consulta falharia; melhor não subir do que parecer saudável.
    if not settings.cnpja_api_key:
        raise RuntimeError("CNPJ_LOOKUP_CNPJA_API_KEY não configurada")
    logger.info("cnpj_lookup_service_starting")
    yield
    await get_client().close()
    logger.info("cnpj_lookup_service_stopped")


app = FastAPI(
    title="cnpj-lookup-service",
    description=(
        "Consulta de CNPJ (dados da Receita + Inscrições Estaduais via CCC) pelo CNPJá. "
        "Serviço genérico e stateless, reaproveitável em outros projetos: não decide "
        "se um CNPJ já foi consultado antes — isso é de quem chama."
    ),
    version="0.1.0",
    lifespan=lifespan,
)
app.include_router(router)
