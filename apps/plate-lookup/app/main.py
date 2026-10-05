from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes import router
from app.client.puxa_placa import get_client
from app.core.config import settings
from app.core.logging import configure_logging, get_logger

configure_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail fast: sem token toda consulta falharia; melhor não subir do que parecer saudável.
    if not settings.puxa_placa_token:
        raise RuntimeError("PLATE_LOOKUP_PUXA_PLACA_TOKEN não configurado")
    logger.info("plate_lookup_service_starting")
    yield
    await get_client().close()
    logger.info("plate_lookup_service_stopped")


app = FastAPI(
    title="plate-lookup-service",
    description=(
        "Consulta de dados veiculares por placa via API Puxa Placa, para o Fixer. "
        "Serviço stateless: não decide se uma placa já foi consultada antes — isso "
        "é responsabilidade de quem chama."
    ),
    version="0.1.0",
    lifespan=lifespan,
)
app.include_router(router)
