# Bootstrap layer: creates the S3 bucket + DynamoDB lock table that every
# other Terraform root (platform/, environments/tenants/) uses as its
# backend. This root's OWN state stays local (terraform.tfstate in this
# folder, committed nowhere) — it cannot use the backend it is creating.
#
# Run this exactly once per AWS account, before anything else:
#   cd infra/terraform/bootstrap
#   terraform init
#   terraform apply

terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "state_bucket_name" {
  type    = string
  default = "fixer-terraform-state"
}

variable "lock_table_name" {
  type    = string
  default = "fixer-terraform-locks"
}

provider "aws" {
  region = var.aws_region
}

resource "aws_s3_bucket" "state" {
  bucket = var.state_bucket_name

  # Every tenant's state lives here (platform/terraform.tfstate,
  # tenants/env:/<slug>/terraform.tfstate) — losing this bucket means
  # losing the ability to safely change any tenant's infrastructure.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Prevents two `terraform apply` runs (e.g. two tenants provisioning at
# once) from racing on the same state file.
resource "aws_dynamodb_table" "locks" {
  name         = var.lock_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}

output "state_bucket_name" {
  value = aws_s3_bucket.state.bucket
}

output "lock_table_name" {
  value = aws_dynamodb_table.locks.name
}
