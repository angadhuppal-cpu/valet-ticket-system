# Random password for database
resource "random_password" "db_password" {
  length  = 32
  special = true
}

# Cloud SQL PostgreSQL instance
resource "google_sql_database_instance" "valet_db" {
  name             = "${var.cloud_run_service_name}-db"
  database_version = "POSTGRES_15"
  region           = var.region

  depends_on = [google_service_networking_connection.private_vpc_connection]

  settings {
    tier              = var.db_tier
    availability_type = "ZONAL"
    disk_size         = 10
    disk_type         = "PD_SSD"

    backup_configuration {
      enabled            = true
      start_time         = "03:00"
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.vpc.id
      require_ssl     = false
    }
  }

  deletion_protection = false
}

# Database
resource "google_sql_database" "valet" {
  name     = var.db_name
  instance = google_sql_database_instance.valet_db.name
}

# Database user
resource "google_sql_user" "valet_user" {
  name     = var.db_user
  instance = google_sql_database_instance.valet_db.name
  password = random_password.db_password.result
}

# VPC for private IP
resource "google_compute_network" "vpc" {
  name                    = "${var.cloud_run_service_name}-vpc"
  auto_create_subnetworks = false
}

# Subnet
resource "google_compute_subnetwork" "subnet" {
  name          = "${var.cloud_run_service_name}-subnet"
  ip_cidr_range = "10.0.0.0/24"
  region        = var.region
  network       = google_compute_network.vpc.id
}

# VPC peering for Cloud SQL
resource "google_compute_global_address" "private_ip_address" {
  name          = "${var.cloud_run_service_name}-private-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_address.name]
}

# VPC Access Connector for Cloud Run
resource "google_vpc_access_connector" "connector" {
  name          = "valet-connector"
  region        = var.region
  ip_cidr_range = "10.8.0.0/28"
  network       = google_compute_network.vpc.name
  machine_type  = "e2-micro"
  min_throughput = 200
  max_throughput = 300
}

# Secret Manager for sensitive data
resource "google_secret_manager_secret" "gemini_api_key" {
  secret_id = "${var.cloud_run_service_name}-gemini-key"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "gemini_api_key_version" {
  secret      = google_secret_manager_secret.gemini_api_key.id
  secret_data = var.gemini_api_key
}

resource "google_secret_manager_secret" "db_password" {
  secret_id = "${var.cloud_run_service_name}-db-password"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "db_password_version" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = random_password.db_password.result
}

# Artifact Registry for Docker images
resource "google_artifact_registry_repository" "valet_repo" {
  location      = var.region
  repository_id = var.cloud_run_service_name
  format        = "DOCKER"
  description   = "Docker repository for valet ticket system"
}

# Cloud Run service
resource "google_cloud_run_v2_service" "valet_app" {
  name     = var.cloud_run_service_name
  location = var.region

  template {
    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.valet_repo.repository_id}/valet-app:latest"

      ports {
        container_port = 8080
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "DATABASE_URL"
        value = "postgresql://${var.db_user}:${urlencode(random_password.db_password.result)}@${google_sql_database_instance.valet_db.private_ip_address}:5432/${var.db_name}"
      }

      env {
        name = "GEMINI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.gemini_api_key.secret_id
            version = "latest"
          }
        }
      }

      env {
        name  = "GEMINI_MODEL"
        value = "gemini-flash-latest"
      }

      env {
        name  = "SIGNUP_CODE"
        value = var.signup_code
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    vpc_access {
      connector = google_vpc_access_connector.connector.id
      egress    = "PRIVATE_RANGES_ONLY"
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  depends_on = [
    google_sql_database_instance.valet_db,
    google_service_networking_connection.private_vpc_connection
  ]
}

# IAM policy to allow unauthenticated access
# NOTE: Disabled due to organization policy restricting public access
# resource "google_cloud_run_v2_service_iam_member" "public_access" {
#   location = google_cloud_run_v2_service.valet_app.location
#   name     = google_cloud_run_v2_service.valet_app.name
#   role     = "roles/run.invoker"
#   member   = "allUsers"
# }

# Custom domain mapping for Cloud Run
resource "google_cloud_run_domain_mapping" "valet_domain" {
  location = var.region
  name     = "valet-ticket-system.ansssol.com"

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.valet_app.name
  }
}

# IAM for Secret Manager access
resource "google_secret_manager_secret_iam_member" "gemini_key_access" {
  secret_id = google_secret_manager_secret.gemini_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_cloud_run_v2_service.valet_app.template[0].service_account}"
}

resource "google_secret_manager_secret_iam_member" "db_password_access" {
  secret_id = google_secret_manager_secret.db_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_cloud_run_v2_service.valet_app.template[0].service_account}"
}

# Enable required APIs
resource "google_project_service" "required_apis" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "vpcaccess.googleapis.com",
    "servicenetworking.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
  ])

  service            = each.key
  disable_on_destroy = false
}
