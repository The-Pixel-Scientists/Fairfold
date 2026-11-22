# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Rate limits per client address on the API, a first layer only: the API's
# own counters stay the authority (ADR 0030). The numbers are ADR 0030's.
# Cloud Armor counts over fixed windows and has no burst, so 20 a second is
# 200 in 10 seconds, and uploads at once per address are left to the API's
# limits. A refusal is a 429; Cloud Armor adds no Retry-After.

resource "google_compute_security_policy" "api" {
  name        = "${local.name}-api"
  description = "Rate limits per client address on the API."
  type        = "CLOUD_ARMOR"

  rule {
    action      = "throttle"
    priority    = 1000
    description = "Uploads: 30 a minute per address."

    match {
      expr {
        expression = "request.method == 'POST' && request.path.startsWith('/api/') && request.path.endsWith('/files')"
      }
    }

    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"

      rate_limit_threshold {
        count        = 30
        interval_sec = 60
      }
    }
  }

  rule {
    action      = "throttle"
    priority    = 2000
    description = "API requests: 200 in 10 seconds per address."

    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }

    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"

      rate_limit_threshold {
        count        = 200
        interval_sec = 10
      }
    }
  }

  rule {
    action      = "allow"
    priority    = 2147483647
    description = "Everything within the limits."

    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }
}
