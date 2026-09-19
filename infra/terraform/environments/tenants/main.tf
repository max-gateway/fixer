# Entry point run by the control plane's provisioning pipeline for a new client.
# One workspace per tenant (e.g. `terraform workspace new oficina-silva`),
# so each `apply` only ever touches that one tenant's state.
#
# Usage:
#   terraform workspace new <tenant_slug>
#   terraform apply -var tenant_slug=<tenant_slug> -var tenant_display_name="..."

terraform {
  required_version = ">= 1.7"
  # Bucket and lock table created once by infra/terraform/bootstrap.
  backend "s3" {
    bucket         = "fixer-terraform-state"
    key            = "tenants/terraform.tfstate" # combined with workspace prefix automatically
    region         = "us-east-1"
    dynamodb_table = "fixer-terraform-locks"
    encrypt        = true
  }
}

variable "tenant_slug" {
  type = string
}

variable "tenant_display_name" {
  type = string
}

variable "image_tag" {
  type    = string
  default = "latest" # CI overrides with the release tag being rolled out
}

data "terraform_remote_state" "platform" {
  backend = "s3"
  config = {
    bucket = "fixer-terraform-state"
    key    = "platform/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "kubernetes" {
  host                   = data.terraform_remote_state.platform.outputs.cluster_endpoint
  cluster_ca_certificate = base64decode(data.terraform_remote_state.platform.outputs.cluster_ca_certificate)
  token                  = data.terraform_remote_state.platform.outputs.cluster_token
}

provider "helm" {
  kubernetes {
    host                   = data.terraform_remote_state.platform.outputs.cluster_endpoint
    cluster_ca_certificate = base64decode(data.terraform_remote_state.platform.outputs.cluster_ca_certificate)
    token                  = data.terraform_remote_state.platform.outputs.cluster_token
  }
}

module "tenant" {
  source = "../../modules/tenant"

  tenant_slug          = var.tenant_slug
  tenant_display_name  = var.tenant_display_name
  base_domain          = "fixer.app"
  db_subnet_group_name = data.terraform_remote_state.platform.outputs.db_subnet_group_name
  db_security_group_id = data.terraform_remote_state.platform.outputs.tenant_rds_security_group_id
  image_repository     = "123456789.dkr.ecr.us-east-1.amazonaws.com/fixer"
  image_tag            = var.image_tag
  keycloak_auth_server_url = "https://auth.fixer.app"
}

resource "helm_release" "tenant" {
  name       = var.tenant_slug
  namespace  = module.tenant.namespace
  chart      = "../../../helm/fixer-tenant" # path to the Helm chart in this repo
  values     = []

  set {
    name  = "tenant.slug"
    value = var.tenant_slug
  }
  set {
    name  = "tenant.displayName"
    value = var.tenant_display_name
  }
  set {
    name  = "image.repository"
    value = "123456789.dkr.ecr.us-east-1.amazonaws.com/fixer"
  }
  set {
    name  = "image.tag"
    value = var.image_tag
  }
  set {
    name  = "ingress.apiHost"
    value = module.tenant.api_host
  }
  set {
    name  = "ingress.webHost"
    value = module.tenant.web_host
  }
  set {
    name  = "ingress.tlsSecretName"
    value = "${var.tenant_slug}-tls"
  }
  set {
    name  = "secrets.databaseUrlSecretName"
    value = module.tenant.database_url_secret_name
  }
  set {
    name  = "secrets.redisUrlSecretName"
    value = module.tenant.redis_url_secret_name
  }
  set {
    name  = "secrets.keycloakSecretName"
    value = module.tenant.keycloak_secret_name
  }
  set {
    name  = "keycloak.realm"
    value = module.tenant.keycloak_realm
  }
  set {
    name  = "keycloak.authServerUrl"
    value = "https://auth.fixer.app"
  }
}

output "web_url" {
  value = "https://${module.tenant.web_host}"
}
