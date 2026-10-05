from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class PlateFormat(str, Enum):
    MERCOSUL = "mercosul"
    LEGACY_BR = "legacy_br"
    UNKNOWN = "unknown"


class RecognitionStatus(str, Enum):
    ACCEPTED = "accepted"           # confiança suficiente, resultado final
    PENDING_VOTE = "pending_vote"   # aguardando mais frames para fechar por votação
    REJECTED = "rejected"           # não passou na validação de formato / confiança


class CandidatePlate(BaseModel):
    """Uma leitura candidata bruta, antes de validação/correção."""

    plate: str
    confidence: float = Field(ge=0.0, le=100.0)


class RecognitionResult(BaseModel):
    """Resultado final (pós validação + correção + eventual votação)."""

    plate: str | None
    plate_format: PlateFormat
    confidence: float = Field(ge=0.0, le=100.0)
    status: RecognitionStatus
    frames_used: int
    raw_candidates: list[CandidatePlate]


class RecognizeRequestMeta(BaseModel):
    """Metadados que acompanham a imagem/lote, vindos da câmera/edge."""

    location_id: str = Field(..., description="Identificador da unidade/portaria/câmera")
    vehicle_track_id: str | None = Field(
        default=None,
        description=(
            "ID de rastreamento do mesmo veículo entre frames, se o edge já fizer "
            "tracking. Usado para agrupar frames na votação multi-frame."
        ),
    )
    captured_at: datetime | None = None


class RecognizeAcceptedResponse(BaseModel):
    request_id: str
    status: RecognitionStatus
    message: str = "Recebido para processamento; resultado será publicado na fila."


class PlateEvent(BaseModel):
    """Payload publicado no stream Redis para o Fixer core consumir."""

    request_id: str
    location_id: str
    vehicle_track_id: str | None
    result: RecognitionResult
    captured_at: datetime | None
    processed_at: datetime
