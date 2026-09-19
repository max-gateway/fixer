# CI setup

`build-and-push.yml` needs one GitHub repo secret:

- `AWS_ECR_PUSH_ROLE_ARN` — the value of the `github_ecr_push_role_arn`
  output from `infra/terraform/platform` (applied after setting
  `github_repo` to this repo's real `org/repo`).

No AWS access keys are stored in GitHub — the workflow authenticates via
OIDC using that role.
