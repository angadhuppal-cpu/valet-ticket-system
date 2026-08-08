# GCP Cloud Run Deployment Guide

This guide walks you through deploying the Valet Ticket System to Google Cloud Platform using Cloud Run and Cloud SQL.

## Architecture

- **Cloud Run**: Serverless container platform hosting the Node.js application
- **Cloud SQL (PostgreSQL 15)**: Managed PostgreSQL database
- **Artifact Registry**: Docker image repository
- **Secret Manager**: Secure storage for API keys and credentials
- **VPC**: Private network for Cloud Run to Cloud SQL connection

## Prerequisites

1. **GCP Account**: Active Google Cloud Platform account
2. **GCP Project**: Create a new project or use an existing one
3. **Tools Installed**:
   - [gcloud CLI](https://cloud.google.com/sdk/docs/install)
   - [Terraform](https://developer.hashicorp.com/terraform/downloads) (>= 1.5)
   - [Docker](https://docs.docker.com/get-docker/)
4. **API Key**: Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)

## Setup Steps

### 1. Authenticate with GCP

```bash
# Login to GCP
gcloud auth login

# Set your project ID
export PROJECT_ID="your-gcp-project-id"
gcloud config set project $PROJECT_ID

# Enable required APIs (will be done by Terraform, but good to verify)
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  vpcaccess.googleapis.com \
  servicenetworking.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com
```

### 2. Configure Terraform Variables

```bash
cd terraform

# Copy the example variables file
cp terraform.tfvars.example terraform.tfvars

# Edit terraform.tfvars with your values
# Required variables:
#   - project_id: Your GCP project ID
#   - gemini_api_key: Your Gemini API key
#   - region: GCP region (default: us-central1)
```

### 3. Deploy Infrastructure with Terraform

```bash
# Initialize Terraform
terraform init

# Review the deployment plan
terraform plan

# Deploy the infrastructure
terraform apply

# Save the outputs (database URL, Cloud Run URL, etc.)
terraform output
```

This will create:
- Cloud SQL PostgreSQL instance
- VPC and networking
- Secret Manager secrets
- Artifact Registry repository
- Cloud Run service (initial deployment without image)

### 4. Build and Push Docker Image

```bash
cd ..  # Back to project root

# Configure Docker to use Artifact Registry
gcloud auth configure-docker us-central1-docker.pkg.dev

# Get the Artifact Registry URL from Terraform output
export REGION="us-central1"  # or your chosen region
export ARTIFACT_REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/valet-ticket-system"

# Build the Docker image
docker build -t ${ARTIFACT_REGISTRY}/valet-app:latest .

# Push to Artifact Registry
docker push ${ARTIFACT_REGISTRY}/valet-app:latest
```

### 5. Deploy to Cloud Run

After pushing the image, Terraform will need to be applied again to update Cloud Run with the new image:

```bash
cd terraform
terraform apply
```

### 6. Access Your Application

```bash
# Get the Cloud Run URL
terraform output cloud_run_url

# Open in browser
gcloud run services describe valet-ticket-system --region=us-central1 --format='value(status.url)'
```

## Important Notes

### Database Migration Status

**IMPORTANT**: The current codebase uses synchronous SQLite database calls, but PostgreSQL requires async/await.

The dual-database support has been implemented in `src/db.js`, but `src/server.js` and `src/auth.js` need to be updated to use `async/await` for all database operations.

**Next Steps**:
1. Update all route handlers in `server.js` to be async functions
2. Add `await` to all database calls (e.g., `db.prepare().get()` → `await db.prepare().get()`)
3. Update `auth.js` functions to be async
4. Test locally with PostgreSQL before deploying

Example of required changes:
```javascript
// Before (SQLite - synchronous)
app.get('/api/tickets', (req, res) => {
  const tickets = db.prepare('SELECT * FROM tickets').all();
  res.json(tickets);
});

// After (PostgreSQL - asynchronous)
app.get('/api/tickets', async (req, res) => {
  const tickets = await db.prepare('SELECT * FROM tickets').all();
  res.json(tickets);
});
```

### Local Development

The app automatically uses SQLite when `DATABASE_URL` is not set:

```bash
# Local development (SQLite)
npm start

# Test with PostgreSQL locally
export DATABASE_URL="postgresql://user:pass@localhost:5432/valet"
npm start
```

### Environment Variables

Cloud Run sets these automatically via Terraform:
- `DATABASE_URL`: PostgreSQL connection string
- `GEMINI_API_KEY`: From Secret Manager
- `GEMINI_MODEL`: gemini-flash-latest
- `PORT`: 3000
- `NODE_ENV`: production

## Cost Estimation

**Monthly costs** (approximate):
- Cloud Run: ~$0-5 (free tier covers most small-scale usage)
- Cloud SQL (db-f1-micro): ~$7.50/month
- VPC Access Connector: ~$7.00/month
- Secret Manager: $0.06 per 10k accesses (minimal)
- Artifact Registry: $0.10/GB storage (minimal)

**Total**: ~$15-20/month for light usage

To minimize costs:
- Set `min_instances = 0` in Terraform variables (default)
- Use `db-f1-micro` tier for database (default)
- Consider Cloud SQL scheduled backups retention

## Updating the Application

```bash
# Make code changes

# Rebuild and push Docker image
docker build -t ${ARTIFACT_REGISTRY}/valet-app:latest .
docker push ${ARTIFACT_REGISTRY}/valet-app:latest

# Deploy new revision to Cloud Run
gcloud run deploy valet-ticket-system \
  --region=us-central1 \
  --image=${ARTIFACT_REGISTRY}/valet-app:latest
```

## Cleanup

To delete all resources:

```bash
cd terraform
terraform destroy
```

**Warning**: This will permanently delete your database and all data!

## Troubleshooting

### Cloud Run service fails to start

```bash
# Check Cloud Run logs
gcloud run services logs read valet-ticket-system --region=us-central1 --limit=50
```

### Database connection issues

```bash
# Verify Cloud SQL instance is running
gcloud sql instances list

# Check VPC connector
gcloud compute networks vpc-access connectors list --region=us-central1
```

### Build errors

```bash
# Test Docker build locally
docker build -t valet-test .
docker run -p 3000:3000 valet-test
```

## Security Considerations

1. **Secrets**: Never commit `terraform.tfvars` or `.env` to version control
2. **Database**: Cloud SQL uses private IP with SSL
3. **API Keys**: Stored in Secret Manager
4. **Authentication**: First user account creation is open; set `SIGNUP_CODE` for subsequent signups

## Support

For issues:
1. Check [Cloud Run documentation](https://cloud.google.com/run/docs)
2. Review [Cloud SQL documentation](https://cloud.google.com/sql/docs)
3. Check application logs in Cloud Logging

## Next Steps

1. Complete the async/await migration in server.js and auth.js
2. Set up CI/CD with GitHub Actions or Cloud Build
3. Configure custom domain with Cloud Run
4. Set up monitoring and alerting
5. Configure automated backups for Cloud SQL
