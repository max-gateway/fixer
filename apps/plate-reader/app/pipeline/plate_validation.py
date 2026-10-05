"""Validação e correção determinística de placas brasileiras.

Não há nenhum componente probabilístico "de IA" aqui: apenas regex de formato
e uma tabela de substituição de confusões ópticas conhecidas (O/0, I/1, B/8, S/5, ...),
aplicada de acordo com o tipo de caractere esperado em cada posição do formato.

Formatos suportados:
  - Mercosul:      LLL N L NN   (ex.: ABC1D23)  -> posições: L L L N L N N
  - Antigo (BR):   LLL NNNN     (ex.: ABC1234)  -> posições: L L L N N N N
"""

import re
from dataclasses import dataclass

from app.models.schemas import PlateFormat

_MERCOSUL_RE = re.compile(r"^[A-Z]{3}[0-9][A-Z][0-9]{2}$")
_LEGACY_RE = re.compile(r"^[A-Z]{3}[0-9]{4}$")

# "L" = deve ser letra, "N" = deve ser dígito, por posição (0-indexed)
_MERCOSUL_SHAPE = "LLLNLNN"
_LEGACY_SHAPE = "LLLNNNN"

# Confusões ópticas mais comuns em OCR de placa. Chave = caractere lido,
# valor = para o que corrigir dependendo se a posição espera letra ou dígito.
_LETTER_TO_DIGIT = {
    "O": "0",
    "I": "1",
    "Z": "2",
    "B": "8",
    "S": "5",
    "G": "6",
    "Q": "0",
}
_DIGIT_TO_LETTER = {v: k for k, v in _LETTER_TO_DIGIT.items()}
# Preferências manuais onde a inversão automática do dict daria a letra "errada"
# mais comum (ex.: '0' é mais frequentemente confundido com 'O' do que com 'Q').
_DIGIT_TO_LETTER.update({"0": "O", "1": "I", "2": "Z", "8": "B", "5": "S", "6": "G"})


@dataclass(frozen=True)
class ValidationResult:
    plate: str | None
    plate_format: PlateFormat
    corrected: bool


def _try_correct(raw: str, shape: str) -> tuple[str, int] | None:
    """Tenta ajustar `raw` ao `shape` esperado. Retorna (placa_corrigida,
    numero_de_correcoes_aplicadas) ou None se não for possível encaixar no shape.
    O número de correções é usado para desempatar entre formatos de mesmo
    comprimento (ex.: Mercosul e antigo, ambos com 7 caracteres): o formato que
    exige menos correções é o mais provável de ser o correto.
    """
    if len(raw) != len(shape):
        return None
    chars = list(raw)
    corrections = 0
    for i, expected in enumerate(shape):
        c = chars[i]
        if expected == "L" and c.isdigit():
            if c in _DIGIT_TO_LETTER:
                chars[i] = _DIGIT_TO_LETTER[c]
                corrections += 1
            else:
                return None
        elif expected == "N" and c.isalpha():
            if c in _LETTER_TO_DIGIT:
                chars[i] = _LETTER_TO_DIGIT[c]
                corrections += 1
            else:
                return None
        elif expected == "L" and not c.isalpha():
            return None
        elif expected == "N" and not c.isdigit():
            return None
    return "".join(chars), corrections


def validate_and_correct(raw_plate: str) -> ValidationResult:
    """Normaliza, tenta casar contra os dois formatos BR, corrigindo confusões
    ópticas posicionais quando necessário. Retorna plate=None se não for
    possível validar em nenhum dos dois formatos.
    """
    normalized = re.sub(r"[^A-Za-z0-9]", "", raw_plate).upper()

    if _MERCOSUL_RE.match(normalized):
        return ValidationResult(normalized, PlateFormat.MERCOSUL, corrected=False)
    if _LEGACY_RE.match(normalized):
        return ValidationResult(normalized, PlateFormat.LEGACY_BR, corrected=False)

    # Nenhum dos dois formatos bateu direto: tenta corrigir contra ambos os
    # shapes (quando o comprimento permitir) e escolhe o que exigir menos
    # correções — evita que uma placa antiga ambígua (mesmo comprimento do
    # Mercosul) seja incorretamente "corrigida" para o formato errado.
    candidates: list[tuple[str, PlateFormat, int]] = []

    if len(normalized) == len(_MERCOSUL_SHAPE):
        fixed = _try_correct(normalized, _MERCOSUL_SHAPE)
        if fixed and _MERCOSUL_RE.match(fixed[0]):
            candidates.append((fixed[0], PlateFormat.MERCOSUL, fixed[1]))

    if len(normalized) == len(_LEGACY_SHAPE):
        fixed = _try_correct(normalized, _LEGACY_SHAPE)
        if fixed and _LEGACY_RE.match(fixed[0]):
            candidates.append((fixed[0], PlateFormat.LEGACY_BR, fixed[1]))

    if not candidates:
        return ValidationResult(None, PlateFormat.UNKNOWN, corrected=False)

    best_plate, best_format, _ = min(candidates, key=lambda item: item[2])
    return ValidationResult(best_plate, best_format, corrected=True)
