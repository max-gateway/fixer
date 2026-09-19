# Platform layer: created ONCE, shared by every tenant.
# Tenants never touch this — the tenant module only reads its outputs.

terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  # Bucket and lock table created once by infra/terraform/bootstrap.
  backend "s3" {
    bucket         = "fixer-terraform-state"
    key            = "platform/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "fixer-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "cluster_name" {
  type    = string
  default = "fixer-platform"
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "${var.cluster_name}-vpc"
  cidr = "10.0.0.0/16"

  azs             = ["${var.aws_region}a", "${var.aws_region}b", "${var.aws_region}c"]
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]

  enable_nat_gateway = true
  single_nat_gateway = true # cost-saving default; switch to false once traffic justifies HA NAT
}

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = var.cluster_name
  cluster_version = "1.30"

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  eks_managed_node_groups = {
    default = {
      min_size     = 3
      max_size     = 12
      desired_size = 3
      instance_types = ["m6i.large"]
    }
  }
}

# Every tenant's RDS instance is created inside this subnet group.
resource "aws_db_subnet_group" "tenants" {
  name       = "${var.cluster_name}-tenants"
  subnet_ids = module.vpc.private_subnets
}

# Security group allowing the cluster's nodes to reach any tenant's RDS instance.
resource "aws_security_group" "tenant_rds" {
  name   = "${var.cluster_name}-tenant-rds"
  vpc_id = module.vpc.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

output "cluster_name" {
  value = module.eks.cluster_name
}

output "vpc_id" {
  value = module.vpc.vpc_id
}

output "db_subnet_group_name" {
  value = aws_db_subnet_group.tenants.name
}

output "tenant_rds_security_group_id" {
  value = aws_security_group.tenant_rds.id
}
