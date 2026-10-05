from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes import router
from app.core.logging import configure_logging, get_logger
from app.pipeline.engine import build_engine
from app.pipeline.pipeline import PlateRecognitionPipeline
from app.queue.publisher import get_publisher

configure_logging()
logger = get_logger(__name__)

# Engine e pipeline construídos uma única vez no processo (custo de carregar
# o OpenALPR/runtime_data não deve ser pago por request).
pipeline = PlateRecognitionPipeline(engine=build_engine())


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("plate_reader_service_starting")
    yield
    await get_publisher().close()
    logger.info("plate_reader_service_stopped")


app = FastAPI(
    title="plate-reader-service",
    description="Leitura determinística de placas veiculares (OCR, sem IA generativa) para o Fixer.",
    version="0.1.0",
    lifespan=lifespan,
)
app.include_router(router)
