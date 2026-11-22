# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Applies this root against a mocked provider, so no Google account is used,
# and checks ADR 0030's load balancer rules. Run with:
# tofu -chdir=infra/terraform/gcp/edge test

mock_provider "google" {
  mock_resource "google_compute_global_address" {
    defaults = {
      address = "192.0.2.10"
    }
  }
}

variables {
  project        = "tps-test"
  environment    = "staging"
  cell           = "uk"
  console_origin = "https://console.example.org"
  portal_origin  = "https://grants.example.org"
}

run "only_named_hosts_reach_a_backend" {
  assert {
    condition     = google_compute_url_map.https.default_route_action[0].fault_injection_policy[0].abort[0].http_status == 404
    error_message = "A host nobody named must get 404 from the load balancer."
  }

  assert {
    condition     = toset(flatten([for rule in google_compute_url_map.https.host_rule : tolist(rule.hosts)])) == toset(["console.example.org", "grants.example.org"])
    error_message = "The load balancer must answer the console and portal hosts only."
  }

  assert {
    condition = alltrue([
      for matcher in google_compute_url_map.https.path_matcher :
      length(matcher.path_rule) == 1 &&
      toset(matcher.path_rule[0].paths) == toset(["/api/*"]) &&
      matcher.path_rule[0].service == google_compute_backend_service.workload["api"].id
    ])
    error_message = "Under each host, /api/ must go to the API and nothing else may route elsewhere."
  }
}

run "the_forwarded_host_is_the_one_matched" {
  assert {
    condition = alltrue([
      for matcher in google_compute_url_map.https.path_matcher : (
        toset(matcher.header_action[0].request_headers_to_remove) == toset(["Forwarded", "X-Real-IP"]) &&
        matcher.header_action[0].request_headers_to_add[0].header_name == "X-Forwarded-Host" &&
        matcher.header_action[0].request_headers_to_add[0].header_value == { console = "console.example.org", portal = "grants.example.org" }[matcher.name] &&
        matcher.header_action[0].request_headers_to_add[0].replace
      )
    ])
    error_message = "Each host must drop spoofed forwarding headers and set X-Forwarded-Host to itself."
  }
}

run "https_only_with_hsts_and_no_request_log" {
  assert {
    condition     = google_compute_ssl_policy.edge.min_tls_version == "TLS_1_2"
    error_message = "TLS 1.2 is the oldest version allowed."
  }

  assert {
    condition     = google_compute_url_map.http.default_url_redirect[0].https_redirect
    error_message = "Port 80 must only redirect to HTTPS."
  }

  assert {
    condition = alltrue([
      for backend in google_compute_backend_service.workload :
      !backend.log_config[0].enable &&
      contains(backend.custom_response_headers, "Strict-Transport-Security: max-age=63072000; includeSubDomains")
    ])
    error_message = "Every backend must send HSTS and keep no request log, which would hold query strings."
  }
}

run "the_api_is_rate_limited_and_trusts_this_balancer" {
  assert {
    condition     = google_compute_backend_service.workload["api"].security_policy == google_compute_security_policy.api.id
    error_message = "Cloud Armor's limits belong to the API's backend."
  }

  assert {
    condition     = output.api_trust_proxy == "192.0.2.10,35.191.0.0/16,130.211.0.0/22"
    error_message = "The API must trust this load balancer and Google's front ends, and nothing else."
  }
}

run "one_host_for_both_apps_is_refused" {
  command = plan

  variables {
    portal_origin = "https://console.example.org"
  }

  expect_failures = [google_compute_url_map.https]
}
