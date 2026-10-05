import time
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, UploadFile
from fastapi.responses import Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from app.core.logging import get_logger
from app.core.metrics import (
    frames_used_per_recognition,
    plate_event_publish_failures_total,
    recognition_duration_seconds,
    recognition_requests_total,
    recognition_result_total,
)
from app.models.schemas import (
    PlateEvent,
    RecognizeAcceptedResponse,
    RecognitionStatus,
)
from app.pipeline.pipeline import PlateRecognitionPipeline
from app.queue.publisher import EventPublisher, get_publisher

logger = get_logger(__name__)
router = APIRouter()


def get_pipeline() -> PlateRecognitionPipeline:
    # Definido em app.main na inicialização (engine construído uma única vez).
    from app.main import pipeline

    return pipeline


async def _process_and_publish(
    pipeline: PlateRecognitionPipeline,
    publisher: EventPublisher,
    request_id: str,
    location_id: str,
    vehicle_track_id: str | None,
    captured_at: datetime | None,
    frames: list[bytes],
) -> None:
    started_at = time.monotonic()
    if len(frames) == 1:
        result = pipeline.process_single_frame(frames[0])
    else:
        result = pipeline.process_frame_batch(frames)
    recognition_duration_seconds.observe(time.monotonic() - started_at)
    frames_used_per_recognition.observe(result.frames_used)
    recognition_result_total.labels(location_id=location_id, status=result.status.value).inc()

    event = PlateEvent(
        request_id=request_id,
        location_id=location_id,
        vehicle_track_id=vehicle_track_id,
        result=result,
        captured_at=captured_at,
        processed_at=datetime.now(UTC),
    )
    try:
        await publisher.publish(event)
    except Exception:
        plate_event_publish_failures_total.inc()
        logger.exception(
            "plate_event_publish_failed", request_id=request_id, location_id=location_id
        )
        raise


@router.post("/v1/recognize", response_model=RecognizeAcceptedResponse, status_code=202)
async def recognize(
    background_tasks: BackgroundTasks,
    location_id: str = Form(...),
    vehicle_track_id: str | None = Form(default=None),
    captured_at: datetime | None = Form(default=None),
    frames: list[UploadFile] = File(
        ...,
        description="Um ou mais frames JPEG/PNG do mesmo veículo. Múltiplos "
        "frames habilitam a votação de maioria.",
    ),
    pipeline: PlateRecognitionPipeline = Depends(get_pipeline),
) -> RecognizeAcceptedResponse:
    request_id = str(uuid.uuid4())
    frame_bytes = [await f.read() for f in frames]
    recognition_requests_total.labels(location_id=location_id).inc()

    logger.info(
        "recognize_request_received",
        request_id=request_id,
        location_id=location_id,
        vehicle_track_id=vehicle_track_id,
        frame_count=len(frame_bytes),
    )

    background_tasks.add_task(
        _process_and_publish,
        pipeline,
        get_publisher(),
        request_id,
        location_id,
        vehicle_track_id,
        captured_at,
        frame_bytes,
    )

    return RecognizeAcceptedResponse(request_id=request_id, status=RecognitionStatus.PENDING_VOTE)


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/metrics")
async def metrics() -> Response:
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
