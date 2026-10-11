from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.api.routes import get_client
from app.client.cnpja import CnpjaError
from app.client.cnpj_validation import is_valid_cnpj, normalize_cnpj
from app.main import app

client = TestClient(app)

CNPJA_PAYLOAD = {
    "updated": "2026-10-09T13:57:22.935Z",
    "taxId": "00000000000191",
    "company": {
        "name": "BANCO DO BRASIL SA",
        "equity": 120000000000,
        "nature": {"id": 2038, "text": "Sociedade de Economia Mista"},
        "size": {"id": 5, "acronym": "DEMAIS", "text": "Demais"},
    },
    "alias": "Direcao Geral",
    "head": True,
    "status": {"id": 2, "text": "Ativa"},
    "address": {"street": "Quadra Saun", "number": "SN", "district": "Asa Norte",
                "city": "Brasília", "state": "DF", "zip": "70040912"},
    "phones": [{"type": "LANDLINE", "area": "61", "number": "34939002"}],
    "emails": [{"address": "secex@bb.com.br"}],
    "mainActivity": {"id": 6422100, "text": "Bancos múltiplos"},
    "sideActivities": [{"id": 6499999, "text": "Outras atividades"}],
    "registrations": [
        {"number": "0809427800174", "state": "DF", "enabled": True,
         "status": {"id": 1, "text": "Sem restrição"},
         "type": {"id": 3, "text": "IE Não Contribuinte"}},
    ],
    "campo_futuro": {"x": 1},
}


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def _override(**kwargs) -> AsyncMock:
    fake = AsyncMock()
    fake.consulta_cnpj.configure_mock(**kwargs)
    app.dependency_overrides[get_client] = lambda: fake
    return fake


def test_validation_accepts_numeric_and_alphanumeric():
    assert is_valid_cnpj(normalize_cnpj("00.000.000/0001-91"))
    assert is_valid_cnpj("12ABC34501DE35")
    assert not is_valid_cnpj("00000000000192")
    assert not is_valid_cnpj("11111111111111")


def test_invalid_cnpj_returns_422():
    assert client.get("/v1/cnpj/123").status_code == 422


def test_success_returns_normalized_contract_with_ies_and_raw():
    fake = _override(return_value=CNPJA_PAYLOAD)

    response = client.get("/v1/cnpj/00.000.000-000191")

    assert response.status_code == 200
    body = response.json()
    assert body["razao_social"] == "BANCO DO BRASIL SA"
    assert body["situacao"] == "Ativa"
    assert body["endereco"]["uf"] == "DF"
    assert body["telefones"] == ["6134939002"]
    assert body["cnae_principal"] == {"codigo": "6422100", "descricao": "Bancos múltiplos"}
    assert body["inscricoes_estaduais"][0]["numero"] == "0809427800174"
    assert body["inscricoes_estaduais"][0]["situacao"] == "Sem restrição"
    assert body["raw"]["campo_futuro"] == {"x": 1}
    fake.consulta_cnpj.assert_awaited_once_with("00000000000191")


@pytest.mark.parametrize(
    ("error_type", "status"),
    [("not_found", 404), ("rate_limited", 429), ("timeout", 504), ("no_credits", 502)],
)
def test_upstream_error_is_translated(error_type, status):
    _override(side_effect=CnpjaError("erro", error_type))
    assert client.get("/v1/cnpj/00000000000191").status_code == status


def test_healthz():
    assert client.get("/healthz").json() == {"status": "ok"}
