from app.models.schemas import Cnae, EmpresaCnpj, Endereco, InscricaoEstadual


def _text(node: dict | None) -> str | None:
    return (node or {}).get("text")


def _cnae(node: dict) -> Cnae:
    return Cnae(codigo=str(node.get("id", "")), descricao=node.get("text", ""))


def to_empresa(raw: dict, cnpj: str) -> EmpresaCnpj:
    """Converte a resposta do CNPJá no contrato do serviço."""
    company = raw.get("company") or {}
    address = raw.get("address")

    return EmpresaCnpj(
        cnpj=raw.get("taxId") or cnpj,
        razao_social=company.get("name"),
        nome_fantasia=raw.get("alias"),
        situacao=_text(raw.get("status")),
        data_situacao=raw.get("statusDate"),
        data_abertura=raw.get("founded"),
        matriz=raw.get("head"),
        natureza_juridica=_text(company.get("nature")),
        porte=_text(company.get("size")),
        capital_social=company.get("equity"),
        cnae_principal=_cnae(raw["mainActivity"]) if raw.get("mainActivity") else None,
        cnaes_secundarios=[_cnae(a) for a in raw.get("sideActivities") or []],
        endereco=(
            Endereco(
                logradouro=address.get("street"),
                numero=address.get("number"),
                complemento=address.get("details"),
                bairro=address.get("district"),
                municipio=address.get("city"),
                uf=address.get("state"),
                cep=address.get("zip"),
            )
            if address
            else None
        ),
        telefones=[f"{p.get('area', '')}{p.get('number', '')}" for p in raw.get("phones") or []],
        emails=[e["address"] for e in raw.get("emails") or [] if e.get("address")],
        inscricoes_estaduais=[
            InscricaoEstadual(
                numero=r["number"],
                uf=r["state"],
                habilitada=r.get("enabled"),
                situacao=_text(r.get("status")),
                tipo=_text(r.get("type")),
                data_situacao=r.get("statusDate"),
            )
            for r in raw.get("registrations") or []
            if r.get("number") and r.get("state")
        ],
        atualizado_em=raw.get("updated"),
        raw=raw,
    )
