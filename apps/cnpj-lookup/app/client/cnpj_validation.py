"""Normalização e validação de CNPJ, inclusive o alfanumérico (NT 2014.002 v1.40).

12 posições [A-Z0-9] + 2 dígitos verificadores, módulo 11 sobre `ord(c) - 48`.
CNPJs numéricos antigos são um caso particular da mesma regra.
"""

import re

_FORMAT = re.compile(r"^[A-Z0-9]{12}[0-9]{2}$")


def normalize_cnpj(raw: str) -> str:
    return re.sub(r"[.\-/\s]", "", raw).upper()


def _check_digit(chars: str) -> int:
    total = 0
    weight = 2
    for ch in reversed(chars):
        total += (ord(ch) - 48) * weight
        weight = 2 if weight == 9 else weight + 1
    rest = total % 11
    return 0 if rest < 2 else 11 - rest


def is_valid_cnpj(cnpj: str) -> bool:
    if not _FORMAT.match(cnpj) or len(set(cnpj)) == 1:
        return False
    d1 = _check_digit(cnpj[:12])
    d2 = _check_digit(cnpj[:12] + str(d1))
    return cnpj.endswith(f"{d1}{d2}")
