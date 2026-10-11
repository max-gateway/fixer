"""Contrato estável de resposta deste serviço.

É independente do formato do provedor (hoje CNPJá): trocar de provedor não
muda o que os consumidores recebem. `raw` guarda a resposta original, porque a
consulta é paga e não deve ser repetida só para obter um campo que o contrato
ainda não expõe.
"""

from pydantic import BaseModel


class Cnae(BaseModel):
    codigo: str
    descricao: str


class Endereco(BaseModel):
    logradouro: str | None = None
    numero: str | None = None
    complemento: str | None = None
    bairro: str | None = None
    municipio: str | None = None
    uf: str | None = None
    cep: str | None = None


class InscricaoEstadual(BaseModel):
    numero: str
    uf: str
    habilitada: bool | None = None
    situacao: str | None = None  # ex.: "Sem restrição"
    tipo: str | None = None  # ex.: "IE Normal", "IE Não Contribuinte ..."
    data_situacao: str | None = None


class EmpresaCnpj(BaseModel):
    cnpj: str
    razao_social: str | None = None
    nome_fantasia: str | None = None
    situacao: str | None = None  # ex.: "Ativa"
    data_situacao: str | None = None
    data_abertura: str | None = None
    matriz: bool | None = None
    natureza_juridica: str | None = None
    porte: str | None = None
    capital_social: float | None = None
    cnae_principal: Cnae | None = None
    cnaes_secundarios: list[Cnae] = []
    endereco: Endereco | None = None
    telefones: list[str] = []
    emails: list[str] = []
    inscricoes_estaduais: list[InscricaoEstadual] = []
    atualizado_em: str | None = None
    raw: dict
