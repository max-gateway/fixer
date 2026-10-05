"""Segmentação de caracteres individuais dentro da região da placa já
recortada/corrigida, e OCR caractere-a-caractere via Tesseract.

Reconhecer um caractere de cada vez (em vez de jogar a placa inteira para o
Tesseract) reduz drasticamente o espaço de decisão do OCR — 36 classes
possíveis (A-Z, 0-9) por posição, com fonte padronizada — o que é bem mais
assertivo do que OCR de texto livre.
"""

from dataclasses import dataclass

import cv2
import numpy as np
import pytesseract

# Faixa de proporção altura/largura de um caractere de placa BR (a fonte
# Mandatory é mais alta que larga). Filtra ruído/parafusos/moldura que
# sobrevivem à binarização mas não são caracteres.
_MIN_CHAR_HEIGHT_FRACTION = 0.35  # relativo à altura da placa recortada
_MAX_CHAR_HEIGHT_FRACTION = 0.95
_MIN_CHAR_ASPECT_RATIO = 0.15
_MAX_CHAR_ASPECT_RATIO = 0.9

# --psm 8 (trata a imagem como uma única palavra) se mostrou bem mais
# confiável que --psm 10 (single char) nos testes: o modo "single char" do
# Tesseract é conhecido por ser instável em várias versões/glifos, incluindo
# falhas silenciosas de detecção (confidence -1, texto vazio) mesmo com o
# caractere claramente legível. Como cada imagem já contém um único
# caractere pré-segmentado, --psm 8 se comporta efetivamente como "single
# char" na prática, com detecção bem mais robusta.
_TESSERACT_CONFIG = "--psm 8 --oem 3 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

_OCR_TARGET_HEIGHT = 48  # px de altura do caractere enviado ao Tesseract (ampliado)

_PLATE_SCALE_HEIGHTS = (100, 140, 200)  # alturas (px) em que a placa é lida para o voto

_PLATE_LENGTH = 7  # todo formato de placa BR (Mercosul ou antigo) tem 7 caracteres


@dataclass(frozen=True)
class SegmentedChar:
    image: np.ndarray
    x_position: int  # posição horizontal no recorte, para ordenar da esquerda p/ direita


def _binarize(plate_gray: np.ndarray) -> np.ndarray:
    # Otsu funciona bem aqui porque a região já foi recortada e corrigida:
    # histograma bimodal claro entre caracteres escuros e fundo claro (ou
    # vice-versa, dependendo do padrão de placa/retrorreflexão).
    _, binary = cv2.threshold(plate_gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return binary


def _to_char_image(binary: np.ndarray, x: int, y: int, w: int, h: int) -> np.ndarray:
    char_img = binary[y : y + h, x : x + w]
    # Tesseract espera fundo claro / texto escuro — binarizamos com
    # THRESH_BINARY_INV para segmentar, então invertemos de volta aqui.
    char_img = cv2.bitwise_not(char_img)
    # Padding ajuda o Tesseract a não confundir a borda do caractere
    # com ruído de página.
    return cv2.copyMakeBorder(char_img, 10, 10, 10, 10, cv2.BORDER_CONSTANT, value=255)


def _split_merged_component(
    binary: np.ndarray, x: int, y: int, w: int, h: int, single_char_width: float
) -> list[SegmentedChar]:
    """Caracteres adjacentes que se tocam (comum em imagens de baixa
    resolução/blur, ou em fontes onde traços vizinhos colidem) aparecem como
    um único componente conectado largo demais para passar no filtro de
    aspect ratio. Em vez de descartar o componente inteiro (perdendo N
    caracteres de uma vez), estimamos quantos caracteres ele contém a partir
    da largura média de um caractere "normal" na mesma placa, e o dividimos
    em fatias verticais de largura igual.

    Isso é uma aproximação — funciona bem quando os caracteres fundidos têm
    largura parecida (caso comum), mas pode cortar de forma desalinhada
    caracteres muito distintos em largura (ex.: 'I' colado com 'W'). Ainda
    assim, dá ao Tesseract uma chance de reconhecer o texto em vez de
    descartar a leitura inteira por causa de 2-3 caracteres colados.
    """
    estimated_count = round(w / single_char_width)
    if estimated_count < 2:
        return []

    slice_width = w // estimated_count
    if slice_width <= 0:
        return []

    segments = []
    for i in range(estimated_count):
        slice_x = x + i * slice_width
        # última fatia absorve o resto da divisão inteira
        actual_width = w - i * slice_width if i == estimated_count - 1 else slice_width
        char_img = _to_char_image(binary, slice_x, y, actual_width, h)
        segments.append(SegmentedChar(image=char_img, x_position=slice_x))
    return segments


def segment_characters(plate_gray: np.ndarray) -> list[SegmentedChar]:
    """Segmenta caracteres individuais via componentes conectados,
    filtrando por altura/proporção esperadas de um caractere de placa.

    Componentes largos demais para ser um único caractere (caracteres
    adjacentes que se tocam) são divididos em fatias estimadas — ver
    _split_merged_component.
    """
    binary = _binarize(plate_gray)
    plate_height = plate_gray.shape[0]

    num_labels, _, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)

    normal_components: list[tuple[int, int, int, int]] = []  # x, y, w, h
    oversized_components: list[tuple[int, int, int, int]] = []

    for label in range(1, num_labels):  # label 0 é o fundo
        x, y, w, h, area = stats[label]
        if area <= 0 or w == 0 or h == 0:
            continue

        height_fraction = h / plate_height
        if not (_MIN_CHAR_HEIGHT_FRACTION <= height_fraction <= _MAX_CHAR_HEIGHT_FRACTION):
            continue

        aspect_ratio = w / h
        if aspect_ratio > _MAX_CHAR_ASPECT_RATIO:
            # candidato a "múltiplos caracteres colados" — só decidimos
            # depois de saber a largura média dos componentes normais.
            oversized_components.append((x, y, w, h))
            continue
        if aspect_ratio < _MIN_CHAR_ASPECT_RATIO:
            continue

        normal_components.append((x, y, w, h))

    candidates: list[SegmentedChar] = [
        SegmentedChar(image=_to_char_image(binary, x, y, w, h), x_position=x)
        for x, y, w, h in normal_components
    ]

    if oversized_components and normal_components:
        avg_width = sum(w for _, _, w, _ in normal_components) / len(normal_components)
        for x, y, w, h in oversized_components:
            candidates.extend(_split_merged_component(binary, x, y, w, h, avg_width))

    candidates.sort(key=lambda c: c.x_position)
    return candidates


def _tesseract_best(image: np.ndarray, config: str) -> tuple[str, float] | None:
    data = pytesseract.image_to_data(image, config=config, output_type=pytesseract.Output.DICT)
    best_text = ""
    best_conf = -1.0
    for text, conf in zip(data["text"], data["conf"]):
        text = text.strip()
        conf_value = float(conf)
        if text and conf_value > best_conf:
            best_text = text
            best_conf = conf_value
    if not best_text:
        return None
    # Tesseract às vezes retorna mais de um caractere por segmento (ruído);
    # mantemos só o primeiro, que é o que a whitelist deveria produzir.
    return best_text[0].upper(), max(best_conf, 0.0)


def _upscaled(char_image: np.ndarray) -> np.ndarray:
    """Amplia o caractere para uma altura que o Tesseract lê bem. Caracteres de
    placas pequenas na imagem chegam com ~10 px de altura."""
    h, w = char_image.shape[:2]
    scale = _OCR_TARGET_HEIGHT / h
    big = cv2.resize(char_image, (max(1, int(w * scale)), _OCR_TARGET_HEIGHT), interpolation=cv2.INTER_CUBIC)
    _, big = cv2.threshold(big, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return cv2.copyMakeBorder(big, 10, 10, 10, 10, cv2.BORDER_CONSTANT, value=255)


def ocr_single_char(char_image: np.ndarray) -> tuple[str, float] | None:
    """Roda Tesseract em um único caractere já segmentado. Retorna
    (caractere, confiança 0-100) ou None se nada foi reconhecido.

    Tenta a imagem original e uma versão ampliada, e fica com a leitura de maior
    confiança: um único caractere vazio não pode derrubar a placa inteira, e
    nenhuma das duas variantes é melhor em todos os glifos (medido).
    """
    attempts = [
        _tesseract_best(char_image, _TESSERACT_CONFIG),
        _tesseract_best(_upscaled(char_image), _TESSERACT_CONFIG),
    ]
    results = [a for a in attempts if a is not None]
    return max(results, key=lambda r: r[1]) if results else None


def _vote_positions(readings: list[tuple[str, list[float]]]) -> tuple[str, float]:
    """Voto por posição entre leituras da mesma placa (escalas diferentes). O peso
    de cada caractere é a sua confiança, então um empate cai no mais confiante."""
    chars: list[str] = []
    confidences: list[float] = []
    for position in range(_PLATE_LENGTH):
        weight: dict[str, float] = {}
        votes: dict[str, list[float]] = {}
        for text, confs in readings:
            weight[text[position]] = weight.get(text[position], 0.0) + confs[position] + 1.0
            votes.setdefault(text[position], []).append(confs[position])
        winner = max(weight, key=lambda c: weight[c])
        chars.append(winner)
        confidences.append(sum(votes[winner]) / len(votes[winner]))
    return "".join(chars), sum(confidences) / len(confidences)


def _read_once(plate_gray: np.ndarray) -> tuple[str, list[float]] | None:
    segments = segment_characters(plate_gray)
    if len(segments) != _PLATE_LENGTH:
        return None
    chars: list[str] = []
    confidences: list[float] = []
    for segment in segments:
        result = ocr_single_char(segment.image)
        if result is None:
            return None
        chars.append(result[0])
        confidences.append(result[1])
    return "".join(chars), confidences


def recognize_plate_text(plate_gray: np.ndarray) -> tuple[str, float] | None:
    """Segmenta e reconhece cada caractere da placa recortada, retornando
    a string completa e a confiança média entre os caracteres lidos.

    A placa é lida em mais de uma escala e o resultado sai por voto por posição:
    glifos ambíguos em baixa resolução (9/3, 8/B...) mudam de leitura conforme a
    escala, então uma única escala fixa é sorte (medido: 9 virava 3 em alturas
    intermediárias). Placas já grandes são lidas só no tamanho original.

    Retorna None se nenhuma escala segmentar o número esperado de caracteres (7) —
    evita alimentar o validador com uma leitura já sabida como incompleta/ruidosa.
    """
    height = plate_gray.shape[0]
    heights = [t for t in _PLATE_SCALE_HEIGHTS if t > height]
    inputs = [plate_gray]
    if heights:
        inputs = [
            cv2.resize(plate_gray, None, fx=t / height, fy=t / height, interpolation=cv2.INTER_CUBIC)
            for t in heights
        ]

    readings = [r for r in (_read_once(img) for img in inputs) if r is not None]
    if not readings:
        return None
    return _vote_positions(readings)
