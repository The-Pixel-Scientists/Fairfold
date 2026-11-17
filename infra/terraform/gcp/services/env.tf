# SPDX-License-Identifier: AGPL-3.0-or-later
#
# What each workload is given: plain settings, and the NAME_FILE path of
# each secret it mounts, one directory per secret (secrets.tf). Cloud Run
# sets only PORT and K_* or CLOUD_RUN_* variables of its own, none of them
# TPS_* or a proxy variable, which the API and worker refuse (ADR 0010).

locals {
  database_env = {
    TPS_DB_HOST = local.db_host
    TPS_DB_PORT = "5432"
    TPS_DB_NAME = var.db_name
    TPS_DB_TLS  = "verify-full"
  }

  # Path-style requests to Cloud Storage's S3-compatible API (storage.tf).
  files_env = {
    TPS_STORAGE_ENDPOINT              = "https://storage.googleapis.com"
    TPS_STORAGE_REGION                = "auto"
    TPS_STORAGE_BUCKET                = google_storage_bucket.files.name
    TPS_STORAGE_WRITE_ACCESS_KEY_ID   = google_storage_hmac_key.files["write"].access_id
    TPS_STORAGE_READ_ACCESS_KEY_ID    = google_storage_hmac_key.files["read"].access_id
    TPS_STORAGE_SCANNER_ACCESS_KEY_ID = google_storage_hmac_key.files["scanner"].access_id
    TPS_CLAMD_HOST                    = var.clamd.host
    TPS_CLAMD_PORT                    = tostring(var.clamd.port)
    # ADR 0047: 5 seconds after clamd's MaxScanTime.
    TPS_CLAMD_TIMEOUT_MS = "25000"
    TPS_FILES_MAX_STORES = "4"
  }

  smtp_env = {
    TPS_SMTP_HOST = var.smtp.host
    TPS_SMTP_PORT = tostring(var.smtp.port)
    TPS_SMTP_TLS  = var.smtp.tls
    TPS_SMTP_USER = var.smtp.user
    TPS_SMTP_FROM = var.smtp.from
  }

  plain_env = {
    api = merge(local.database_env, local.files_env, local.smtp_env, {
      TPS_API_HOST            = "0.0.0.0"
      TPS_API_PORT            = "3000"
      TPS_API_TRUST_PROXY     = var.api_trust_proxy
      TPS_CONSOLE_ORIGIN      = var.console_origin
      TPS_PORTAL_ORIGIN       = var.portal_origin
      TPS_SUBJECT_KEK_VERSION = "1"
    })
    worker = merge(local.database_env, local.files_env, local.smtp_env, {
      TPS_PORTAL_ORIGIN                 = var.portal_origin
      TPS_SUBJECT_KEK_VERSION           = "1"
      TPS_STORAGE_REMOVAL_ACCESS_KEY_ID = google_storage_hmac_key.files["removal"].access_id
    })
    migrate = local.database_env
    console = {}
    portal  = {}
  }

  # The secrets each workload mounts, one directory each, and every variable
  # it is given, the secrets' NAME_FILE paths included.
  mounts = {
    for workload in local.workloads : workload => {
      for name, secret in local.secrets : name => {
        env     = secret.env
        version = lookup(local.secret_versions, name, "latest")
      } if contains(secret.readers, workload)
    }
  }
  env = {
    for workload in local.workloads : workload => merge(
      local.plain_env[workload],
      { for name, mount in local.mounts[workload] : mount.env => "/run/secrets/${name}/value" },
    )
  }

  # The web servers' own /api/ forwarding is left off: the load balancer
  # sends /api/ to the API (ADR 0030).
  web_args = ["node", "web-server.ts", "--root", "dist", "--host", "0.0.0.0", "--port", "8080"]

  services = {
    api     = { image = var.images.api, port = 3000, memory = "1Gi", args = null }
    console = { image = var.images.console, port = 8080, memory = "512Mi", args = local.web_args }
    portal  = { image = var.images.portal, port = 8080, memory = "512Mi", args = local.web_args }
  }
}
