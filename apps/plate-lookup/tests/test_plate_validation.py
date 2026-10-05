from app.client.plate_validation import is_valid_plate, normalize_plate


def test_normalize_plate_strips_separators_and_uppercases():
    assert normalize_plate("abc-1d23") == "ABC1D23"
    assert normalize_plate(" abc1234 ") == "ABC1234"


def test_valid_mercosul_plate():
    assert is_valid_plate("ABC1D23") is True


def test_valid_legacy_plate():
    assert is_valid_plate("ABC1234") is True


def test_invalid_plate():
    assert is_valid_plate("ABCD123") is False
    assert is_valid_plate("AB1234") is False
    assert is_valid_plate("") is False
