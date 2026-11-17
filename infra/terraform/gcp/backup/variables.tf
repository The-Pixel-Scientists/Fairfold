# SPDX-License-Identifier: AGPL-3.0-or-later

variable "project" {
  description = "Google Cloud project id for this environment and cell, where the job runs."
  type        = string
}

variable "environment" {
  description = "Deployment environment."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "cell" {
  description = "Jurisdiction the deployment serves (ADR 0012)."
  type        = string

  validation {
    condition     = contains(["uk"], var.cell)
    error_message = "cell must be uk."
  }
}

variable "backup_project" {
  description = "The separate backup project this root creates: its id, the organisation it sits in and the billing account it uses."
  type = object({
    id              = string
    org_id          = string
    billing_account = string
  })

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.backup_project.id)) && var.backup_project.id != var.project
    error_message = "backup_project.id must be a valid project id, and not the cell's own project."
  }
}

variable "image" {
  description = "The backup job's release image, by digest."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9.-]+(/[a-z0-9._-]+)+@sha256:[0-9a-f]{64}$", var.image))
    error_message = "image must be a reference by digest, registry/path@sha256:<64 hex digits>, never a tag."
  }
}

variable "backup_store" {
  description = "The off-site backup store with object lock: its endpoint, region and bucket, and the address ranges its endpoint resolves to, the only ones the job may reach outside the cell."
  type = object({
    endpoint = string
    region   = string
    bucket   = string
    ranges   = list(string)
  })

  validation {
    condition     = can(regex("^https://[a-z0-9.-]+$", var.backup_store.endpoint))
    error_message = "backup_store.endpoint must be https://<host>, with no port or path."
  }

  validation {
    condition = length(var.backup_store.ranges) > 0 && alltrue([
      for range in var.backup_store.ranges : can(cidrnetmask(range)) && tonumber(split("/", range)[1]) >= 16
    ])
    error_message = "backup_store.ranges must list the store's IPv4 ranges, each /16 or narrower."
  }
}

variable "key_id" {
  description = "Id of the key version the recipients secret holds, for TPS_BACKUP_KEY_ID."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9._-]{0,63}$", var.key_id))
    error_message = "key_id must be a short id of lower-case letters, digits, dots and hyphens."
  }
}

variable "databases" {
  description = "Databases to dump, comma-separated, the application database first, for TPS_BACKUP_DATABASES."
  type        = string
  default     = "tps"
}
