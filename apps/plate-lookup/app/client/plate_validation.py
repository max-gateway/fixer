"""Validação leve do formato de placa recebido na rota.

Aceita os dois formatos brasileiros — não corrige nem tenta OCR (isso é
responsabilidade do plate-reader); aqui a placa já vem digitada/lida por
outra fonte, só validamos a forma antes de gastar uma chamada paga na API
externa.
"""

import re

_MERCOSUL_RE = re.compile(r"^[A-Z]{3}[0-9][A-Z][0-9]{2}$")
_LEGACY_RE = re.compile(r"^[A-Z]{3}[0-9]{4}$")


def normalize_plate(raw: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", raw).upper()


def is_valid_plate(plate: str) -> bool:
    return bool(_MERCOSUL_RE.match(plate) or _LEGACY_RE.match(plate))
