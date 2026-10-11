"""Documentação tipada do payload da Puxa Placa v2.

NÃO é usado para filtrar a resposta: a rota repassa o JSON cru do provedor.
Campos não listados aqui (ex.: motor, cilindradas, potencia) existem de fato.
"""

from pydantic import BaseModel


class BasicoDados(BaseModel):
    marcamodelo: str | None = None
    rouboFurto: str | None = None
    mensagemRetorno: str | None = None
    final_chassi: str | None = None
    modelo: str | None = None
    marca: str | None = None
    cor: str | None = None
    ano: int | None = None
    anoModelo: int | None = None
    municipio: str | None = None
    uf: str | None = None
    origem: str | None = None
    placa_modelo_novo: str | None = None
    placa_modelo_antigo: str | None = None
    especie: str | None = None
    tipo: str | None = None
    combustivel: str | None = None
    data: str | None = None
    atualizado: bool | None = None
    logo: str | None = None


class BasicoBlock(BaseModel):
    error: bool = False
    message: str | None = None
    dados: BasicoDados | None = None
    execucao: str | None = None


class ChassiDados(BaseModel):
    chassi: str | None = None


class ChassiBlock(BaseModel):
    error: bool = False
    message: str | None = None
    dados: ChassiDados | None = None
    execucao: str | None = None


class RenavamDados(BaseModel):
    renavam: str | None = None


class RenavamBlock(BaseModel):
    error: bool = False
    message: str | None = None
    dados: RenavamDados | None = None
    execucao: str | None = None


class RouboFurtoDados(BaseModel):
    rouboFurto: str | None = None
    data: str | None = None


class RouboFurtoBlock(BaseModel):
    error: bool = False
    message: str | None = None
    dados: RouboFurtoDados | None = None
    execucao: str | None = None


class FipeHistoricoItem(BaseModel):
    valor: str | None = None
    mes_referencia: str | None = None


class FipeDadosItem(BaseModel):
    valor: str | None = None
    marca: str | None = None
    modelo: str | None = None
    ano: str | None = None
    combustivel: str | None = None
    codigo_fipe: str | None = None
    mes_referencia: str | None = None
    score: int | None = None
    historico: list[FipeHistoricoItem] = []


class FipeBlock(BaseModel):
    error: bool = False
    message: str | None = None
    dados: list[FipeDadosItem] = []
    execucao: str | None = None


class PlateLookupResult(BaseModel):
    """Resposta completa da consulta de veículo por placa (Puxa Placa v2)."""

    error: bool = False
    message: str | None = None
    basico: BasicoBlock | None = None
    chassi: ChassiBlock | None = None
    renavam: RenavamBlock | None = None
    rouboFurto: RouboFurtoBlock | None = None
    fipe: FipeBlock | None = None
