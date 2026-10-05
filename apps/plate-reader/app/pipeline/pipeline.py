from app.core.config import settings
from app.core.logging import get_logger
from app.models.schemas import CandidatePlate, PlateFormat, RecognitionResult, RecognitionStatus
from app.pipeline.engine import OCREngine
from app.pipeline.plate_validation import validate_and_correct
from app.pipeline.voting import majority_vote

logger = get_logger(__name__)


class PlateRecognitionPipeline:
    def __init__(self, engine: OCREngine) -> None:
        self._engine = engine

    def process_single_frame(self, image_bytes: bytes) -> RecognitionResult:
        """Processa um único frame (sem votação). Usado quando não há
        agrupamento por vehicle_track_id disponível.
        """
        raw_candidates = self._engine.recognize(image_bytes)
        return self._finalize([], raw_candidates)

    def process_frame_batch(self, frames: list[bytes]) -> RecognitionResult:
        """Processa múltiplos frames do mesmo veículo e decide o resultado
        final por votação de maioria entre os candidatos já validados.
        """
        all_raw: list[CandidatePlate] = []
        validated: list[CandidatePlate] = []

        for frame in frames:
            raw_candidates = self._engine.recognize(frame)
            all_raw.extend(raw_candidates)
            best = self._best_validated_candidate(raw_candidates)
            if best is not None:
                validated.append(best)

        return self._finalize(validated, all_raw, frames_used=len(frames))

    def _best_validated_candidate(
        self, raw_candidates: list[CandidatePlate]
    ) -> CandidatePlate | None:
        """Dentre os candidatos brutos de um frame, retorna o de maior
        confiança que passa (com ou sem correção) na validação de formato BR.
        """
        for candidate in raw_candidates:
            validation = validate_and_correct(candidate.plate)
            if validation.plate is not None:
                return CandidatePlate(plate=validation.plate, confidence=candidate.confidence)
        return None

    def _finalize(
        self,
        validated_candidates: list[CandidatePlate],
        raw_candidates: list[CandidatePlate],
        frames_used: int = 1,
    ) -> RecognitionResult:
        if not validated_candidates and not raw_candidates:
            return RecognitionResult(
                plate=None,
                plate_format=PlateFormat.UNKNOWN,
                confidence=0.0,
                status=RecognitionStatus.REJECTED,
                frames_used=frames_used,
                raw_candidates=[],
            )

        # Caso de frame único: valida direto o melhor candidato bruto.
        if not validated_candidates and raw_candidates:
            best = self._best_validated_candidate(raw_candidates)
            if best is None:
                return RecognitionResult(
                    plate=None,
                    plate_format=PlateFormat.UNKNOWN,
                    confidence=0.0,
                    status=RecognitionStatus.REJECTED,
                    frames_used=frames_used,
                    raw_candidates=raw_candidates,
                )
            validated_candidates = [best]

        if len(validated_candidates) < settings.min_frames_for_vote:
            # Não há frames suficientes para fechar por votação; aceita se a
            # confiança do único/poucos candidatos já for alta o bastante.
            top = max(validated_candidates, key=lambda c: c.confidence)
            validation = validate_and_correct(top.plate)
            status = (
                RecognitionStatus.ACCEPTED
                if top.confidence >= settings.min_confidence_single_frame
                else RecognitionStatus.PENDING_VOTE
            )
            return RecognitionResult(
                plate=validation.plate,
                plate_format=validation.plate_format,
                confidence=top.confidence,
                status=status,
                frames_used=frames_used,
                raw_candidates=raw_candidates,
            )

        vote_result = majority_vote(validated_candidates)
        if vote_result is None:
            return RecognitionResult(
                plate=None,
                plate_format=PlateFormat.UNKNOWN,
                confidence=0.0,
                status=RecognitionStatus.REJECTED,
                frames_used=frames_used,
                raw_candidates=raw_candidates,
            )

        final_plate, confidence = vote_result
        validation = validate_and_correct(final_plate)
        return RecognitionResult(
            plate=validation.plate,
            plate_format=validation.plate_format,
            confidence=confidence,
            status=RecognitionStatus.ACCEPTED if validation.plate else RecognitionStatus.REJECTED,
            frames_used=frames_used,
            raw_candidates=raw_candidates,
        )
