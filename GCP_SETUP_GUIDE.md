# Manual GCP Project Setup Guide

Follow these steps to manually set up your GCP project for the Valet Ticketing System.

## Step 1: Authenticate with GCP

```bash
# Login with your account
gcloud auth login nirmaljit.singh@ansssol.com

# Set the account
gcloud config set account nirmaljit.singh@ansssol.com
```

## Step 2: Create the Project

```bash
# Create the project
gcloud projects create valet-ticketing-system \
    --name="Valet Ticketing System" \
    --set-as-default

# Set as current project
gcloud config set project valet-ticketing-system
```

## Step 3: Link Billing Account

Visit the billing page and link a billing account to your project:
https://console.cloud.google.com/billing/linkedaccount?project=valet-ticketing-system

**Important**: The project needs billing enabled to use Cloud Run, Cloud SQL, and other services.

## Step 4: Enable Required APIs

```bash
# Enable all required Google Cloud APIs
gcloud services enable \
    cloudresourcemanager.googleapis.com \
    serviceusage.googleapis.com \
    compute.googleapis.com \
    run.googleapis.com \
    sqladmin.googleapis.com \
    vpcaccess.googleapis.com \
    servicenetworking.googleapis.com \
    secretmanager.googleapis.com \
    artifactregistry.googleapis.com
```

This will take a few minutes to complete.

## Step 5: Set IAM Permissions

```bash
# Grant yourself owner permissions (if not already granted)
gcloud projects add-iam-policy-binding valet-ticketing-system \
    --member="user:nirmaljit.singh@ansssol.com" \
    --role="roles/owner"
```

## Step 6: Configure Terraform

```bash
cd terraform

# Create terraform.tfvars from the example
cp terraform.tfvars.example terraform.tfvars

# Edit the file with your configuration
# Replace the placeholders with actual values
```

Your `terraform.tfvars` should look like:

```hcl
project_id              = "valet-ticketing-system"
region                  = "us-central1"
gemini_api_key          = "YOUR_GEMINI_API_KEY_HERE"  # Get from https://aistudio.google.com/apikey
cloud_run_service_name  = "valet-ticket-system"
signup_code             = ""
db_tier                 = "db-f1-micro"
min_instances           = 0
max_instances           = 10
```

## Step 7: Get Gemini API Key

1. Visit https://aistudio.google.com/apikey
2. Create a new API key
3. Copy the key and add it to `terraform.tfvars`

## Step 8: Initialize and Deploy with Terraform

```bash
cd terraform

# Initialize Terraform
terraform init

# Review what will be created
terraform plan

# Deploy the infrastructure
terraform apply
```

Type `yes` when prompted to confirm the deployment.

## Step 9: Build and Deploy Docker Image

After Terraform completes:

```bash
cd ..  # Back to project root

# Configure Docker authentication
gcloud auth configure-docker us-central1-docker.pkg.dev

# Build the Docker image
docker build -t us-central1-docker.pkg.dev/valet-ticketing-system/valet-ticket-system/valet-app:latest .

# Push to Artifact Registry
docker push us-central1-docker.pkg.dev/valet-ticketing-system/valet-ticket-system/valet-app:latest

# Update Cloud Run with the new image
cd terraform
terraform apply
```

## Step 10: Access Your Application

Get your application URL:

```bash
terraform output cloud_run_url
```

Or visit:
```bash
gcloud run services describe valet-ticket-system \
    --region=us-central1 \
    --format='value(status.url)'
```

## Verify Deployment

Check that everything is working:

1. Visit your Cloud Run URL
2. Create the first admin account
3. Test ticket creation with AI photo analysis

## Project Console Links

- **Project Dashboard**: https://console.cloud.google.com/home/dashboard?project=valet-ticketing-system
- **Cloud Run**: https://console.cloud.google.com/run?project=valet-ticketing-system
- **Cloud SQL**: https://console.cloud.google.com/sql/instances?project=valet-ticketing-system
- **Logs**: https://console.cloud.google.com/logs/query?project=valet-ticketing-system

## Cost Monitoring

Set up budget alerts:
https://console.cloud.google.com/billing/budgets?project=valet-ticketing-system

Recommended: Set a budget alert at $20-30/month

## Troubleshooting

### Billing not linked error
Make sure you've linked a billing account in Step 3

### API not enabled error
Run the gcloud services enable commands again from Step 4

### Permission denied errors
Verify you have owner role with:
```bash
gcloud projects get-iam-policy valet-ticketing-system \
    --flatten="bindings[].members" \
    --filter="bindings.members:user:nirmaljit.singh@ansssol.com"
```

### Check deployment logs
```bash
gcloud run services logs read valet-ticket-system \
    --region=us-central1 \
    --limit=50
```
