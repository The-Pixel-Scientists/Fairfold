# SPDX-License-Identifier: AGPL-3.0-or-later

variable "name" {
  description = "Name prefix, tps-<environment>-<cell>. The database root looks the network up by it."
  type        = string
}

variable "region" {
  description = "Region of the subnet, router and egress address."
  type        = string
}

variable "subnet_range" {
  description = "CIDR range of the subnet Cloud Run's direct VPC egress uses."
  type        = string
}
