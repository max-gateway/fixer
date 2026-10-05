"""Detecção por faixas de texto + segmentação, sem depender do binário do Tesseract."""

import sys
import types

import cv2
import numpy as np

# char_ocr importa pytesseract no topo; a segmentação testada aqui não o usa.
sys.modules.setdefault("pytesseract", types.ModuleType("pytesseract"))

from app.pipeline.char_ocr import segment_characters  # noqa: E402
from app.pipeline.plate_detection import _iou, detect_plate_regions  # noqa: E402


def _scene(text: str, plate_w: int) -> bytes:
    """Cena sintética: placa clara com texto escuro sobre fundo cinza, em um quadro
    grande (a placa ocupa uma fração pequena da imagem, como numa foto de celular)."""
    img = np.full((900, 1200, 3), 120, dtype=np.uint8)
    plate_h = int(plate_w / 3.2)
    x0, y0 = 500, 520
    cv2.rectangle(img, (x0, y0), (x0 + plate_w, y0 + plate_h), (245, 245, 245), -1)
    cv2.rectangle(img, (x0, y0), (x0 + plate_w, y0 + plate_h), (20, 20, 20), 3)
    scale = plate_h / 55
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_DUPLEX, scale, max(2, int(scale * 2)))
    cv2.putText(
        img,
        text,
        (x0 + (plate_w - tw) // 2, y0 + (plate_h + th) // 2),
        cv2.FONT_HERSHEY_DUPLEX,
        scale,
        (10, 10, 10),
        max(2, int(scale * 2)),
    )
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    return buf.tobytes()


def test_finds_small_plate_in_large_frame_and_segments_seven_chars():
    regions = detect_plate_regions(_scene("ABC1234", plate_w=240))
    assert regions, "nenhuma região detectada"
    assert any(len(segment_characters(r.image)) == 7 for r in regions)


def test_returns_no_more_than_max_candidates():
    assert len(detect_plate_regions(_scene("ABC1234", plate_w=240), max_candidates=2)) <= 2


def test_blank_or_invalid_image_returns_empty():
    assert detect_plate_regions(b"not an image") == []
    ok, buf = cv2.imencode(".jpg", np.full((300, 400, 3), 128, dtype=np.uint8))
    assert ok
    assert detect_plate_regions(buf.tobytes()) == []


def test_iou_overlap_and_disjoint():
    assert _iou((0, 0, 10, 10), (0, 0, 10, 10)) == 1.0
    assert _iou((0, 0, 10, 10), (20, 20, 10, 10)) == 0.0
    assert 0 < _iou((0, 0, 10, 10), (5, 0, 10, 10)) < 1


def test_vote_positions_majority_and_confidence_tiebreak():
    from app.pipeline.char_ocr import _vote_positions

    # posição 5: duas leituras dizem '9', uma diz '3' => '9'
    text, conf = _vote_positions([("FHE1292", [80] * 7), ("FHE1232", [80] * 7), ("FHE1292", [70] * 7)])
    assert text == "FHE1292"
    assert 70 <= conf <= 80
    # empate 1x1 desempata pela maior confiança
    text, _ = _vote_positions([("FHE1292", [50] * 7), ("FHE1232", [90] * 7)])
    assert text == "FHE1232"
