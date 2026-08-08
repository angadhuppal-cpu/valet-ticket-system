variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for resources"
  type        = string
  default     = "us-central1"
}

variable "db_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "valet"
}

variable "db_user" {
  description = "PostgreSQL database user"
  type        = string
  default     = "valet_app"
}

variable "gemini_api_key" {
  description = "Google Gemini API key for AI vehicle recognition"
  type        = string
  sensitive   = true
}

variable "signup_code" {
  description = "Optional signup code for account registration"
  type        = string
  default     = ""
  sensitive   = true
}

variable "cloud_run_service_name" {
  description = "Name of the Cloud Run service"
  type        = string
  default     = "valet-ticket-system"
}

variable "db_tier" {
  description = "Cloud SQL instance tier"
  type        = string
  default     = "db-f1-micro"
}

variable "min_instances" {
  description = "Minimum number of Cloud Run instances"
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Maximum number of Cloud Run instances"
  type        = number
  default     = 10
}
