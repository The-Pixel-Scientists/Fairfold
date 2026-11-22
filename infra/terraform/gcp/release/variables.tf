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

variable "repository_id" {
  description = "Numeric id of the GitHub repository whose release workflow may sign in. An id, unlike a name, cannot be taken over by renaming."
  type        = string

  validation {
    condition     = can(regex("^[1-9][0-9]*$", var.repository_id))
    error_message = "repository_id must be the repository's numeric id, as GitHub's API returns it."
  }
}
