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

variable "console_origin" {
  description = "Origin the console is served from, as the services root has it."
  type        = string

  validation {
    condition     = can(regex("^https://[a-z0-9.-]+$", var.console_origin))
    error_message = "console_origin must be https://<host>, with no port or path."
  }
}

variable "portal_origin" {
  description = "Origin the portal is served from, as the services root has it."
  type        = string

  validation {
    condition     = can(regex("^https://[a-z0-9.-]+$", var.portal_origin))
    error_message = "portal_origin must be https://<host>, with no port or path."
  }
}
