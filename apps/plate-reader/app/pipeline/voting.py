"""Votação de maioria caractere-a-caractere entre leituras de múltiplos frames
do mesmo veículo (mesmo vehicle_track_id).

Câmera fixa normalmente entrega vários frames do mesmo veículo passando; ler cada
frame isoladamente e escolher o resultado por consenso posicional é muito mais
robusto do que confiar em uma única leitura, sem introduzir nenhum componente
probabilístico "de IA" — é só contagem.
"""

from collections import Counter

from app.models.schemas import CandidatePlate


def majority_vote(candidates: list[CandidatePlate]) -> tuple[str, float] | None:
    """Recebe candidatos já validados (mesmo formato/comprimento) e retorna
    (placa_final, confiança_media_dos_que_concordaram) via voto de maioria
    posição a posição. Retorna None se a lista estiver vazia.
    """
    if not candidates:
        return None

    length = len(candidates[0].plate)
    # Só vota entre candidatos do mesmo comprimento (mesmo formato de placa);
    # candidatos de comprimento divergente são descartados da votação.
    same_length = [c for c in candidates if len(c.plate) == length]
    if not same_length:
        return None

    result_chars = []
    for i in range(length):
        votes = Counter(c.plate[i] for c in same_length)
        winner, _ = votes.most_common(1)[0]
        result_chars.append(winner)
    final_plate = "".join(result_chars)

    agreeing = [c for c in same_length if c.plate == final_plate]
    if agreeing:
        avg_confidence = sum(c.confidence for c in agreeing) / len(agreeing)
    else:
        # Nenhum frame individual bateu exatamente com o resultado da votação
        # (winner por posição veio de frames diferentes); usa a média geral
        # como confiança mais conservadora.
        avg_confidence = sum(c.confidence for c in same_length) / len(same_length)

    return final_plate, avg_confidence
