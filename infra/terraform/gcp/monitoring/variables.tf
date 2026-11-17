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

variable "alert_email" {
  description = "Mailbox the operators on call read, which receives every alert."
  type        = string

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.alert_email))
    error_message = "alert_email must be an email address."
  }
}
