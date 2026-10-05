from app.models.schemas import CandidatePlate
from app.pipeline.voting import majority_vote


def test_majority_vote_picks_winning_char_per_position():
    candidates = [
        CandidatePlate(plate="ABC1D23", confidence=90.0),
        CandidatePlate(plate="ABC1D23", confidence=88.0),
        CandidatePlate(plate="ABC1D28", confidence=70.0),  # último char divergente
    ]
    plate, confidence = majority_vote(candidates)
    assert plate == "ABC1D23"
    assert confidence == (90.0 + 88.0) / 2


def test_majority_vote_ignores_candidates_with_different_length():
    candidates = [
        CandidatePlate(plate="ABC1D23", confidence=90.0),
        CandidatePlate(plate="ABC1D23", confidence=88.0),
        CandidatePlate(plate="AB1234", confidence=99.0),  # comprimento diferente
    ]
    plate, confidence = majority_vote(candidates)
    assert plate == "ABC1D23"


def test_majority_vote_empty_returns_none():
    assert majority_vote([]) is None
