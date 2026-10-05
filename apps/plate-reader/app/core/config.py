from enum import Enum

from pydantic_settings import BaseSettings, SettingsConfigDict


class OCREngineName(str, Enum):
    OPENCV_TESSERACT = "opencv_tesseract"
    MOCK = "mock"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PLATE_READER_", env_file=".env")

    # Qual motor de OCR usar. Em produção deve ser OPENCV_TESSERACT; cai para
    # MOCK automaticamente se o binário tesseract não estiver disponível
    # (ver pipeline/engine.py).
    ocr_engine: OCREngineName = OCREngineName.OPENCV_TESSERACT

    # Confiança mínima (0-100) para aceitar uma leitura sem exigir votação multi-frame.
    min_confidence_single_frame: float = 85.0

    # Número mínimo de frames concordantes para fechar o resultado por votação.
    min_frames_for_vote: int = 3

    # Redis / fila de eventos
    redis_url: str = "redis://redis:6379/0"
    redis_stream_name: str = "plate-reader:events"
    redis_stream_maxlen: int = 100_000

    log_level: str = "INFO"


settings = Settings()
