from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PLATE_LOOKUP_", env_file=".env")

    # Token de autenticação da API Puxa Placa (header `token`). Nunca comitar
    # um valor real — sempre via variável de ambiente / secret do ambiente
    # de deploy.
    puxa_placa_token: str = ""
    puxa_placa_base_url: str = "https://api.puxaplaca.app/v2"

    # Timeout da chamada HTTP à API externa.
    puxa_placa_timeout_seconds: float = 10.0

    log_level: str = "INFO"


settings = Settings()
