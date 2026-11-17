# SPDX-License-Identifier: AGPL-3.0-or-later

variable "project" {
  description = "Google Cloud project id for this environment and cell."
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

variable "operators_group" {
  description = "Email of the Google group whose members run the roles script and migrations."
  type        = string

  validation {
    condition     = can(regex("^[^@ ]+@[^@ ]+$", var.operators_group))
    error_message = "operators_group must be a group email address."
  }
}

variable "tier" {
  description = "Cloud SQL machine tier."
  type        = string
  default     = "db-custom-1-3840"
}
