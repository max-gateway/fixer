from app.models.schemas import PlateFormat
from app.pipeline.plate_validation import validate_and_correct


def test_valid_mercosul_plate_passes_unchanged():
    result = validate_and_correct("ABC1D23")
    assert result.plate == "ABC1D23"
    assert result.plate_format == PlateFormat.MERCOSUL
    assert result.corrected is False


def test_valid_legacy_plate_passes_unchanged():
    result = validate_and_correct("ABC1234")
    assert result.plate == "ABC1234"
    assert result.plate_format == PlateFormat.LEGACY_BR
    assert result.corrected is False


def test_corrects_letter_o_read_as_digit_position_in_legacy_plate():
    # posição de dígito lida como 'O' (confusão O/0)
    result = validate_and_correct("ABCO234")
    assert result.plate == "ABC0234"
    assert result.plate_format == PlateFormat.LEGACY_BR
    assert result.corrected is True


def test_corrects_digit_read_as_letter_in_mercosul_only_shape():
    # "ABC1D2O": índice 4 ('D') só é válido como letra (shape Mercosul),
    # o que já descarta o formato antigo (que exigiria dígito ali). O último
    # caractere ('O') precisa ser corrigido para '0' para fechar o Mercosul.
    result = validate_and_correct("ABC1D2O")
    assert result.plate == "ABC1D20"
    assert result.plate_format == PlateFormat.MERCOSUL
    assert result.corrected is True


def test_ambiguous_length_prefers_format_needing_fewer_corrections():
    # "ABCO234": só o índice 3 (O) precisa de correção para virar Legacy
    # (ABC0234). Contra Mercosul exigiria corrigir também o índice 4 (2->Z),
    # duas correções. Deve escolher o formato com menos correções: Legacy.
    result = validate_and_correct("ABCO234")
    assert result.plate == "ABC0234"
    assert result.plate_format == PlateFormat.LEGACY_BR


def test_lowercase_and_punctuation_are_normalized():
    result = validate_and_correct("abc-1d23")
    assert result.plate == "ABC1D23"
    assert result.plate_format == PlateFormat.MERCOSUL


def test_unrecoverable_garbage_is_rejected():
    result = validate_and_correct("!!!!!!!")
    assert result.plate is None
    assert result.plate_format == PlateFormat.UNKNOWN


def test_wrong_length_is_rejected():
    result = validate_and_correct("AB12")
    assert result.plate is None
    assert result.plate_format == PlateFormat.UNKNOWN
