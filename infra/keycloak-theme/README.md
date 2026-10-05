# Tema de login do Keycloak (`fixer`)

Tema único para todos os tenants, sobre `keycloak.v2` (PatternFly 5). Fonte Bai Jamjuree empacotada em `resources/fonts`.

## Cores por tenant

Vêm de **atributos do realm**, lidos em `login/template.ftl`:

| Atributo | Uso | Padrão |
|---|---|---|
| `brandPrimary` | botões, links, foco | `#C2410C` |
| `brandSecondary` | fundo da página de login | `#1C2430` |

O nome mostrado no topo é o `displayName` do realm. O Terraform define tudo isso (`modules/tenant`).
O script do `template.ftl` escurece a cor se ela não tiver contraste 4,5:1 com branco; é o mesmo
cálculo de `legibleOnWhite()` em `apps/web/src/lib/branding.ts`. **Mantenha os dois iguais.**

## Manutenção

- `template.ftl` é uma cópia do `keycloak.v2` 26.0.x com duas mudanças marcadas (bloco `FIXER` e remoção do
  modo escuro automático). Ao subir a versão do Keycloak, compare com o `template.ftl` da nova versão.
- Para trocar a identidade padrão, edite as variáveis `--fx-*` em `resources/css/fixer.css`.

## Instalação

- **Dev (Docker):** `infra/dev/docker-compose.yml` já monta a pasta em `/opt/keycloak/themes/fixer`.
- **Dev (Keycloak local sem Docker):** copie esta pasta para `<keycloak>/themes/fixer`.
  Realm já importado não relê o JSON: defina *Realm settings → Themes → Login theme = fixer* ou use a API admin.
- **Produção:** o tema precisa estar na imagem (ou volume) do Keycloak compartilhado, antes de rodar o Terraform
  dos tenants (`login_theme = "fixer"` aponta para ele).
