"""Interface de motor de OCR + implementações.

Qualquer motor novo só precisa implementar OCREngine.recognize(). O restante
do pipeline (validação, correção, votação) é agnóstico ao motor.
"""

from abc import ABC, abstractmethod

from app.core.config import OCREngineName, settings
from app.core.logging import get_logger
from app.core.metrics import ocr_engine_load_failures_total
from app.models.schemas import CandidatePlate
from app.pipeline.char_ocr import recognize_plate_text
from app.pipeline.plate_detection import detect_plate_regions

logger = get_logger(__name__)


class OCREngine(ABC):
    @abstractmethod
    def recognize(self, image_bytes: bytes) -> list[CandidatePlate]:
        """Recebe os bytes de uma imagem (frame) e retorna candidatos de placa
        detectados nela, ordenados por confiança decrescente. Lista vazia se
        nenhuma placa foi detectada.
        """
        raise NotImplementedError


class OpenCVTesseractEngine(OCREngine):
    """Pipeline determinístico próprio, sem dependência de projeto de
    terceiros estagnado:

      1. Detecção da região da placa por contornos + proporção de aspecto
         (app.pipeline.plate_detection) — adequado a câmera fixa/controlada.
      2. Correção de perspectiva (warp) para a região detectada.
      3. Segmentação de caracteres por componentes conectados
         (app.pipeline.char_ocr).
      4. OCR caractere-a-caractere via Tesseract com whitelist A-Z0-9 e
         `--psm 10` (um único caractere por chamada) — espaço de decisão
         pequeno e fixo, muito mais assertivo que OCR de texto livre.

    Requer o binário `tesseract-ocr` instalado no sistema/container (ver
    Dockerfile) e o pacote Python `pytesseract`.
    """

    def __init__(self) -> None:
        try:
            import pytesseract

            pytesseract.get_tesseract_version()
        except Exception as exc:  # noqa: BLE001 - queremos capturar qualquer falha de binário ausente
            raise RuntimeError(
                "Binário 'tesseract' não encontrado ou inacessível. Instale "
                "tesseract-ocr no sistema/container ou use OCREngineName.MOCK "
                "para dev."
            ) from exc
        logger.info("opencv_tesseract_engine_loaded")

    def recognize(self, image_bytes: bytes) -> list[CandidatePlate]:
        candidates: list[CandidatePlate] = []
        for region in detect_plate_regions(image_bytes):
            result = recognize_plate_text(region.image)
            if result is None:
                continue
            plate_text, ocr_confidence = result
            candidates.append(CandidatePlate(plate=plate_text, confidence=ocr_confidence))

        candidates.sort(key=lambda c: c.confidence, reverse=True)
        return candidates


class MockOCREngine(OCREngine):
    """Motor stub para desenvolvimento/testes sem as dependências nativas
    (OpenCV/Tesseract). NÃO usar em produção — sempre loga um aviso ao ser
    instanciado.
    """

    def __init__(self) -> None:
        logger.warning(
            "using_mock_ocr_engine",
            msg="Motor real indisponível; usando MockOCREngine. Não usar em produção.",
        )

    def recognize(self, image_bytes: bytes) -> list[CandidatePlate]:
        logger.debug("mock_engine_recognize_called", image_size=len(image_bytes))
        return []


def build_engine() -> OCREngine:
    if settings.ocr_engine == OCREngineName.OPENCV_TESSERACT:
        try:
            return OpenCVTesseractEngine()
        except RuntimeError as exc:
            ocr_engine_load_failures_total.inc()
            logger.warning("opencv_tesseract_unavailable_falling_back_to_mock", error=str(exc))
            return MockOCREngine()
    return MockOCREngine()
