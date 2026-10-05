# One instantiation of this module = one workshop (tenant), fully provisioned:
# isolated Postgres, isolated Kubernetes namespace, Keycloak realm, and the
# Secret the fixer-tenant Helm chart expects. `terraform apply` here is the
# automated step behind "new client" in the provisioning pipeline.

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.30"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    keycloak = {
      source  = "mrparkers/keycloak"
      version = "~> 4.4"
    }
  }
}

resource "random_password" "db" {
  length  = 24
  special = false # avoid characters that need escaping in a connection string
}

resource "aws_db_instance" "tenant" {
  identifier     = "fixer-${var.tenant_slug}"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage = 20
  storage_encrypted = true

  db_name  = "fixer"
  username = "fixer_app"
  password = random_password.db.result

  db_subnet_group_name   = var.db_subnet_group_name
  vpc_security_group_ids = [var.db_security_group_id]

  backup_retention_period = 7
  skip_final_snapshot     = false
  final_snapshot_identifier = "fixer-${var.tenant_slug}-final"

  # Isolation is the point of this architecture: no cross-tenant instance sharing.
  tags = {
    fixer_tenant = var.tenant_slug
  }
}

resource "kubernetes_namespace" "tenant" {
  metadata {
    name = var.tenant_slug
    labels = {
      "fixer.io/tenant" = var.tenant_slug
    }
  }
}

resource "kubernetes_secret" "database_url" {
  metadata {
    name      = "${var.tenant_slug}-database-url"
    namespace = kubernetes_namespace.tenant.metadata[0].name
  }
  data = {
    DATABASE_URL = "postgresql://${aws_db_instance.tenant.username}:${random_password.db.result}@${aws_db_instance.tenant.address}:5432/${aws_db_instance.tenant.db_name}"
  }
}

resource "kubernetes_secret" "redis_url" {
  metadata {
    name      = "${var.tenant_slug}-redis-url"
    namespace = kubernetes_namespace.tenant.metadata[0].name
  }
  data = {
    # Hostname matches the headless Service the fixer-tenant Helm chart creates
    # for its Redis StatefulSet (templates/redis.yaml) — Terraform only writes
    # the connection string, Helm owns the actual Redis workload.
    REDIS_URL = "redis://${var.tenant_slug}-redis.${var.tenant_slug}.svc.cluster.local:6379"
  }
}

# One realm per tenant, per the blueprint's Keycloak multi-realm decision.
resource "keycloak_realm" "tenant" {
  realm        = var.tenant_slug
  enabled      = true
  display_name = var.tenant_display_name

  # Tema em infra/keycloak-theme/fixer (precisa estar instalado no Keycloak compartilhado).
  # As cores vão como atributos do realm; o template do tema as lê em runtime.
  login_theme = "fixer"
  attributes = {
    brandPrimary   = var.brand_primary_color
    brandSecondary = var.brand_secondary_color
  }

  internationalization {
    supported_locales = ["pt-BR"]
    default_locale    = "pt-BR"
  }
}

resource "keycloak_openid_client" "api" {
  realm_id  = keycloak_realm.tenant.id
  client_id = "fixer-api"
  name      = "Fixer API"

  access_type = "CONFIDENTIAL"
  standard_flow_enabled = true

  valid_redirect_uris = [
    "https://${var.tenant_slug}.${var.base_domain}/*",
  ]
}

# Client do frontend (Auth.js, server-side, por isso CONFIDENTIAL). O access token
# que ele obtém é o que a API valida (issuer do realm), então o fixer-api acima
# não participa do login do usuário.
resource "keycloak_openid_client" "web" {
  realm_id  = keycloak_realm.tenant.id
  client_id = "fixer-web"
  name      = "Fixer Web"

  access_type           = "CONFIDENTIAL"
  standard_flow_enabled = true

  valid_redirect_uris = [
    "https://${var.tenant_slug}.${var.base_domain}/*",
  ]
}

# Segredo de assinatura da sessão do Auth.js.
resource "random_password" "auth_secret" {
  length = 48
}

resource "kubernetes_secret" "keycloak" {
  metadata {
    name      = "${var.tenant_slug}-keycloak"
    namespace = kubernetes_namespace.tenant.metadata[0].name
  }
  data = {
    CLIENT_SECRET     = keycloak_openid_client.api.client_secret
    WEB_CLIENT_SECRET = keycloak_openid_client.web.client_secret
    AUTH_SECRET       = random_password.auth_secret.result
  }
}

# Seed system roles so the tenant is never left without an Admin.
# (Actual rows are inserted by the API's own migration/seed step on first boot,
# reading TENANT_SLUG from the ConfigMap; Terraform's job stops at infrastructure.)

output "namespace" {
  value = kubernetes_namespace.tenant.metadata[0].name
}

output "database_url_secret_name" {
  value = kubernetes_secret.database_url.metadata[0].name
}

output "redis_url_secret_name" {
  value = kubernetes_secret.redis_url.metadata[0].name
}

output "keycloak_secret_name" {
  value = kubernetes_secret.keycloak.metadata[0].name
}

output "keycloak_realm" {
  value = keycloak_realm.tenant.realm
}

output "api_host" {
  value = "api-${var.tenant_slug}.${var.base_domain}"
}

output "web_host" {
  value = "${var.tenant_slug}.${var.base_domain}"
}
