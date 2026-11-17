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

variable "images" {
  description = "Release image of each workload, by digest: api (the API, worker and migrate job), console and portal."
  type = object({
    api     = string
    console = string
    portal  = string
  })

  validation {
    condition = alltrue([
      for image in values(var.images) : can(regex("^[a-z0-9.-]+(/[a-z0-9._-]+)+@sha256:[0-9a-f]{64}$", image))
    ])
    error_message = "Each image must be a reference by digest, registry/path@sha256:<64 hex digits>, never a tag."
  }
}

variable "console_origin" {
  description = "Origin the console is served from, for TPS_CONSOLE_ORIGIN."
  type        = string

  validation {
    condition     = can(regex("^https://[a-z0-9.-]+$", var.console_origin))
    error_message = "console_origin must be https://<host>, with no port or path."
  }
}

variable "portal_origin" {
  description = "Origin the portal is served from, for TPS_PORTAL_ORIGIN."
  type        = string

  validation {
    condition     = can(regex("^https://[a-z0-9.-]+$", var.portal_origin))
    error_message = "portal_origin must be https://<host>, with no port or path."
  }
}

variable "api_trust_proxy" {
  description = "TPS_API_TRUST_PROXY: the load balancer's addresses and Google's front-end ranges (ADR 0030)."
  type        = string
}

variable "db_name" {
  description = "Database the roles script created, for TPS_DB_NAME."
  type        = string
  default     = "tps"
}

variable "clamd" {
  description = "The virus scanner the API and worker reach (ADR 0047): host and port."
  type = object({
    host = string
    port = number
  })
}

variable "smtp" {
  description = "The in-jurisdiction mail relay (ADR 0012). Its password is the smtp-password secret."
  type = object({
    host = string
    port = number
    tls  = string
    user = string
    from = string
  })

  validation {
    condition     = contains(["starttls", "tls"], var.smtp.tls)
    error_message = "smtp.tls must be starttls or tls: mail leaves the cell encrypted."
  }
}
