output "cloud_run_url" {
  description = "URL of the deployed Cloud Run service"
  value       = google_cloud_run_v2_service.valet_app.uri
}

output "database_instance_name" {
  description = "Cloud SQL instance name"
  value       = google_sql_database_instance.valet_db.name
}

output "database_connection_name" {
  description = "Cloud SQL connection name"
  value       = google_sql_database_instance.valet_db.connection_name
}

output "database_private_ip" {
  description = "Private IP address of Cloud SQL instance"
  value       = google_sql_database_instance.valet_db.private_ip_address
}

output "database_name" {
  description = "PostgreSQL database name"
  value       = google_sql_database.valet.name
}

output "database_user" {
  description = "PostgreSQL database user"
  value       = google_sql_user.valet_user.name
}

output "artifact_registry_url" {
  description = "Artifact Registry repository URL for Docker images"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.valet_repo.repository_id}"
}

output "custom_domain" {
  description = "Custom domain for the application"
  value       = google_cloud_run_domain_mapping.valet_domain.name
}

output "dns_records" {
  description = "DNS records to configure in Squarespace"
  value = <<-EOT

    Configure these DNS records in Squarespace for domain: ansssol.com

    Record Type: CNAME
    Host: valet-ticket-system
    Data: ghs.googlehosted.com
    TTL: 3600

    After adding the CNAME record, the domain mapping will be active in a few minutes.
  EOT
}

output "deployment_instructions" {
  description = "Next steps for deployment"
  value = <<-EOT

    Deployment complete! Next steps:

    1. Build and push Docker image:
       cd /Users/sukhihans/valet-ticket-system
       gcloud auth configure-docker ${var.region}-docker.pkg.dev
       docker build -t ${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.valet_repo.repository_id}/valet-app:latest .
       docker push ${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.valet_repo.repository_id}/valet-app:latest

    2. Access your application:
       ${google_cloud_run_v2_service.valet_app.uri}

    3. Database password is stored in Secret Manager:
       ${google_secret_manager_secret.db_password.secret_id}
  EOT
}
