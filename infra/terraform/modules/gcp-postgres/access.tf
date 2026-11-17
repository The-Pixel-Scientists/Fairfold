# SPDX-License-Identifier: AGPL-3.0-or-later

# Operators log in with their own Google identity. Membership of
# cloudsqlsuperuser lets them run the roles script and migrations.
resource "google_sql_user" "operators" {
  instance       = google_sql_database_instance.main.name
  name           = var.operators_group
  type           = "CLOUD_IAM_GROUP"
  database_roles = ["cloudsqlsuperuser"]
}

resource "google_project_iam_member" "operators_login" {
  project = var.project
  role    = "roles/cloudsql.instanceUser"
  member  = "group:${var.operators_group}"

  condition {
    title      = "${google_sql_database_instance.main.name} only"
    expression = "resource.type == \"sqladmin.googleapis.com/Instance\" && resource.name == \"projects/${var.project}/instances/${google_sql_database_instance.main.name}\""
  }
}
