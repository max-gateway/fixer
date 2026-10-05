"""Detecção da região da placa dentro do frame (visão computacional
determinística, sem redes neurais).

Assume câmera fixa/controlada (portaria, pedágio, estacionamento): ângulo e
distância relativamente estáveis, o que torna viável um detector baseado em
contornos + proporção de aspecto, sem precisar de um detector treinado.
"""

from dataclasses import dataclass

import cv2
import numpy as np

# Proporção largura/altura esperada de uma placa brasileira (~ 40cm x 13cm
# de área útil de caracteres). Faixa larga o suficiente para tolerar alguma
# perspectiva residual após o warp.
_MIN_ASPECT_RATIO = 2.0
_MAX_ASPECT_RATIO = 5.5
_MIN_PLATE_AREA_FRACTION = 0.001  # relativo à área total do frame
_MAX_PLATE_AREA_FRACTION = 0.35


@dataclass(frozen=True)
class PlateRegion:
    """Recorte já com perspectiva corrigida (retangular), pronto para
    segmentação de caracteres."""

    image: np.ndarray  # escala de cinza
    score: float  # heurística de confiança da detecção (não do OCR)


def _order_box_points(pts: np.ndarray) -> np.ndarray:
    """Ordena os 4 pontos do retângulo como [top-left, top-right,
    bottom-right, bottom-left], necessário para um warp consistente."""
    rect = np.zeros((4, 2), dtype=np.float32)
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect


def _warp_plate(gray: np.ndarray, box: np.ndarray) -> np.ndarray:
    rect = _order_box_points(box.astype(np.float32))
    (tl, tr, br, bl) = rect

    width_a = np.linalg.norm(br - bl)
    width_b = np.linalg.norm(tr - tl)
    max_width = max(int(width_a), int(width_b))

    height_a = np.linalg.norm(tr - br)
    height_b = np.linalg.norm(tl - bl)
    max_height = max(int(height_a), int(height_b))

    if max_width == 0 or max_height == 0:
        raise ValueError("Bounding box degenerado (largura ou altura zero).")

    dst = np.array(
        [
            [0, 0],
            [max_width - 1, 0],
            [max_width - 1, max_height - 1],
            [0, max_height - 1],
        ],
        dtype=np.float32,
    )
    matrix = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(gray, matrix, (max_width, max_height))


# Detector complementar: localiza faixas de texto escuro sobre fundo claro (blackhat +
# gradiente horizontal + fechamento). Ao contrário dos contornos da moldura, isso
# isola os caracteres da placa mesmo quando a borda da placa se funde ao para-choque
# (foto de celular, câmera não controlada). Duas escalas, relativas à largura do
# frame, cobrem placas grandes e pequenas na imagem.
_BLACKHAT_SCALES = ((25, 25), (80, 40))  # (divisor do kernel, divisor do fechamento)
_BLACKHAT_PAD = 0.06
_BLACKHAT_DEDUP_IOU = 0.5


def _iou(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix = max(0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0, min(ay + ah, by + bh) - max(ay, by))
    inter = ix * iy
    return inter / (aw * ah + bw * bh - inter) if inter else 0.0


def _text_band_boxes(gray: np.ndarray) -> list[tuple[int, int, int, int]]:
    height, width = gray.shape
    frame_area = height * width
    boxes: list[tuple[int, int, int, int]] = []
    for kernel_div, close_div in _BLACKHAT_SCALES:
        kw = max(7, width // kernel_div)
        kh = max(3, int(kw * 0.3))
        cw = max(9, width // close_div)
        black = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_RECT, (kw, kh)))
        grad = np.absolute(cv2.Sobel(black, cv2.CV_32F, 1, 0, ksize=-1))
        span = grad.max() - grad.min()
        if span <= 0:
            continue
        grad = (255 * (grad - grad.min()) / span).astype("uint8")
        grad = cv2.GaussianBlur(grad, (5, 5), 0)
        grad = cv2.morphologyEx(grad, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (cw, max(3, kh))))
        _, thresh = cv2.threshold(grad, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
        thresh = cv2.dilate(cv2.erode(thresh, None, iterations=1), None, iterations=2)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            if h == 0 or not (_MIN_ASPECT_RATIO - 0.2 <= w / h <= _MAX_ASPECT_RATIO + 1.0):
                continue
            if w < 0.05 * width or (w * h) / frame_area >= _MAX_PLATE_AREA_FRACTION:
                continue
            box = (x, y, w, h)
            if all(_iou(box, other) < _BLACKHAT_DEDUP_IOU for other in boxes):
                boxes.append(box)
    return boxes


def _text_band_regions(gray: np.ndarray) -> list[PlateRegion]:
    ideal = (_MIN_ASPECT_RATIO + _MAX_ASPECT_RATIO) / 2
    regions: list[PlateRegion] = []
    for x, y, w, h in _text_band_boxes(gray):
        pad = int(_BLACKHAT_PAD * h)
        crop = gray[max(0, y - pad) : y + h + pad, max(0, x - pad) : x + w + pad]
        score = max(0.0, 1.0 - abs(w / h - ideal) / ideal)
        regions.append(PlateRegion(image=crop, score=score))
    regions.sort(key=lambda r: r.score, reverse=True)
    return regions


def detect_plate_regions(image_bytes: bytes, max_candidates: int = 8) -> list[PlateRegion]:
    """Detecta candidatos a região de placa no frame, ordenados por confiança
    da detecção (não confundir com confiança de OCR, calculada depois).
    """
    array = np.frombuffer(image_bytes, dtype=np.uint8)
    frame = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if frame is None:
        return []

    frame_area = frame.shape[0] * frame.shape[1]
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    raw_gray = gray  # sem suavização: o detector de faixas de texto precisa do traço fino
    gray = cv2.bilateralFilter(gray, 11, 17, 17)  # reduz ruído preservando bordas
    edges = cv2.Canny(gray, 30, 200)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)

    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    candidates: list[tuple[float, np.ndarray]] = []
    for contour in contours:
        area = cv2.contourArea(contour)
        area_fraction = area / frame_area if frame_area else 0
        if not (_MIN_PLATE_AREA_FRACTION <= area_fraction <= _MAX_PLATE_AREA_FRACTION):
            continue

        rect = cv2.minAreaRect(contour)
        (_, _), (w, h), _ = rect
        if w == 0 or h == 0:
            continue
        aspect_ratio = max(w, h) / min(w, h)
        if not (_MIN_ASPECT_RATIO <= aspect_ratio <= _MAX_ASPECT_RATIO):
            continue

        # Score simples: quanto mais retangular e mais próximo do aspect
        # ratio "ideal" de placa, maior a confiança da detecção.
        rectangularity = area / (w * h) if w * h else 0
        ideal_ratio = (_MIN_ASPECT_RATIO + _MAX_ASPECT_RATIO) / 2
        ratio_score = 1.0 - abs(aspect_ratio - ideal_ratio) / ideal_ratio
        score = 0.5 * rectangularity + 0.5 * max(ratio_score, 0.0)

        box = cv2.boxPoints(rect)
        candidates.append((score, box))

    candidates.sort(key=lambda c: c[0], reverse=True)

    contour_regions: list[PlateRegion] = []
    for score, box in candidates[:max_candidates]:
        try:
            warped = _warp_plate(gray, box)
        except ValueError:
            continue
        contour_regions.append(PlateRegion(image=warped, score=score))

    # Faixas de texto primeiro: em foto não controlada costumam ser o recorte certo
    # (os contornos da moldura tendem a pegar a tampa/para-choque). O engine tenta
    # todos os candidatos e fica com a leitura de maior confiança.
    return (_text_band_regions(raw_gray) + contour_regions)[:max_candidates]
