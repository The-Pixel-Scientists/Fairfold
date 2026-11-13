# SPDX-License-Identifier: AGPL-3.0-or-later

variable "project" {
  description = "Project id, for the operators' login condition."
  type        = string
}

variable "name" {
  description = "Name prefix, tps-<environment>-<cell>."
  type        = string
}

variable "region" {
  description = "Region of the instance and its backups."
  type        = string
}

variable "network" {
  description = "Id of the network with private services access."
  type        = string
}

variable "tier" {
  description = "Cloud SQL machine tier."
  type        = string
}

variable "labels" {
  description = "Labels for the instance, which the provider's default labels do not reach."
  type        = map(string)
}

variable "operators_group" {
  description = "Email of the Google group whose members run the roles script and migrations."
  type        = string
}
