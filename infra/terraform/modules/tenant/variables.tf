variable "tenant_slug" {
  type        = string
  description = "Unique short identifier for the workshop, e.g. \"oficina-silva\""
}

variable "tenant_display_name" {
  type        = string
  description = "Human-readable name shown in branding, e.g. \"Oficina Silva\""
}

variable "brand_primary_color" {
  type        = string
  default     = "#C2410C"
  description = "Cor primária do tenant (hex). O web e o tema de login do Keycloak garantem contraste mínimo com branco."
}

variable "brand_secondary_color" {
  type        = string
  default     = "#1C2430"
  description = "Cor de tinta do tenant (hex): cabeçalhos e fundo do login."
}

variable "base_domain" {
  type        = string
  description = "Platform base domain, e.g. \"fixer.app\""
}

variable "db_subnet_group_name" {
  type        = string
  description = "Output from the platform layer"
}

variable "db_security_group_id" {
  type        = string
  description = "Output from the platform layer"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro" # right-sized for a single small workshop; bump per-tenant if needed
}

variable "image_repository" {
  type = string
}

variable "image_tag" {
  type = string
}

variable "keycloak_auth_server_url" {
  type = string
}
