# @fixer/control-plane

Service that receives "new client" requests and drives the provisioning
pipeline: triggers `terraform apply` against `infra/terraform/environments/tenants`
with the new tenant's slug, then reports back once the Helm release is healthy.

Not yet scaffolded. See the sequence diagram in the architecture blueprint
for the exact flow this service owns.
