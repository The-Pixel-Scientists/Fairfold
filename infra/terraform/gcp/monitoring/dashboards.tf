# SPDX-License-Identifier: AGPL-3.0-or-later
#
# One dashboard per file in infra/observability/dashboards/. Each panel
# becomes a line chart tile in the same place, its queries unchanged; the
# portable grid is 24 columns wide and Cloud Monitoring's is 48.

resource "google_monitoring_dashboard" "dashboard" {
  for_each = local.dashboards

  dashboard_json = jsonencode({
    displayName = "${local.name} ${each.value.title}"
    mosaicLayout = {
      columns = 48
      tiles = [
        for panel in each.value.panels : {
          xPos   = panel.gridPos.x * 2
          yPos   = panel.gridPos.y * 2
          width  = panel.gridPos.w * 2
          height = panel.gridPos.h * 2
          widget = {
            title = panel.title
            xyChart = {
              dataSets = [
                for target in panel.targets : {
                  plotType        = "LINE"
                  targetAxis      = "Y1"
                  timeSeriesQuery = { prometheusQuery = target.expr }
                }
              ]
              yAxis = { scale = "LINEAR" }
            }
          }
        }
      ]
    }
  })

  depends_on = [google_project_service.monitoring]
}
