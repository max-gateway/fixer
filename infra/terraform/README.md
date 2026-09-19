# Fixer infrastructure — apply order

Three roots, applied in this exact order. Each one's backend depends on
the previous having already run.

## 1. `bootstrap/` — once per AWS account

Creates the S3 bucket and DynamoDB lock table that every other root uses
as its remote backend. This root's own state stays **local**
(`terraform.tfstate` in this folder) — it cannot depend on the backend
it is creating.

```
cd bootstrap
terraform init
terraform apply
```

## 2. `platform/` — once per environment (e.g. once for prod)

Creates the shared VPC, EKS cluster, and the RDS subnet group /
security group every tenant's database will use.

```
cd platform
terraform init
terraform apply
```

## 3. `environments/tenants/` — once per client, via workspaces

Each tenant gets its own Terraform workspace, so state and locking never
collide between two clients being provisioned at the same time. This is
the root the control plane (`apps/control-plane`) automates.

```
cd environments/tenants
terraform init
terraform workspace new <tenant_slug>
terraform apply -var tenant_slug=<tenant_slug> -var tenant_display_name="..."
```

This root reads `platform`'s outputs via `terraform_remote_state` and, on
apply, also runs `helm_release` for `infra/helm/fixer-tenant` — one
`apply` provisions the tenant's AWS resources *and* deploys the app.

## Modules

`modules/tenant/` holds the reusable resources for one tenant (RDS
instance, namespace, Kubernetes secrets, Keycloak realm). It has no
backend of its own — it's only ever called from `environments/tenants/`.
