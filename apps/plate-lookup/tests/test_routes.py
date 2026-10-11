from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.api.routes import get_client
from app.client.puxa_placa import PuxaPlacaError
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def test_consulta_placa_invalid_format_returns_422():
    response = client.get("/v1/consulta/XYZ")
    assert response.status_code == 422


def test_consulta_placa_success_returns_puxa_placa_payload():
    fake_client = AsyncMock()
    fake_client.consulta_placa.return_value = {
        "error": False,
        "message": "ok",
        "basico": {
            "error": False,
            "dados": {"marca": "FIAT", "modelo": "UNO", "ano": "2020", "motor": "1.0", "potencia": "71"},
        },
        "campo_futuro": {"x": 1},
    }
    app.dependency_overrides[get_client] = lambda: fake_client

    response = client.get("/v1/consulta/ABC1D23")

    assert response.status_code == 200
    body = response.json()
    assert body["basico"]["dados"]["marca"] == "FIAT"
    # resposta repassada crua: campos desconhecidos e tipos originais preservados
    assert body["basico"]["dados"]["motor"] == "1.0"
    assert body["basico"]["dados"]["ano"] == "2020"
    assert body["campo_futuro"] == {"x": 1}
    fake_client.consulta_placa.assert_awaited_once_with("ABC1D23")


def test_consulta_placa_upstream_error_is_translated_to_http_error():
    fake_client = AsyncMock()
    fake_client.consulta_placa.side_effect = PuxaPlacaError("rate limit", "rate_limited")
    app.dependency_overrides[get_client] = lambda: fake_client

    response = client.get("/v1/consulta/ABC1D23")

    assert response.status_code == 429


def test_healthz():
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readyz_requires_token(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "puxa_placa_token", "")
    assert client.get("/readyz").status_code == 503
    monkeypatch.setattr(settings, "puxa_placa_token", "t")
    assert client.get("/readyz").status_code == 200
