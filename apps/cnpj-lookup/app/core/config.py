from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CNPJ_LOOKUP_", env_file=".env")

    # Chave da API comercial do CNPJá (header `Authorization`). Nunca comitar um
    # valor real — sempre via variável de ambiente / secret do ambiente de deploy.
    cnpja_api_key: str = ""
    cnpja_base_url: str = "https://api.cnpja.com"

    # Timeout da chamada HTTP à API externa.
    cnpja_timeout_seconds: float = 15.0

    log_level: str = "INFO"


settings = Settings()
