#!/bin/bash
# GCP Project Setup Script for Valet Ticketing System
# Run this script to create and configure your GCP project

set -e

echo "=========================================="
echo "GCP Project Setup for Valet Ticketing System"
echo "=========================================="
echo ""

# Configuration
PROJECT_ID="valet-ticketing-system"
PROJECT_NAME="Valet Ticketing System"
ACCOUNT="nirmaljit.singh@ansssol.com"
REGION="us-central1"

echo "Configuration:"
echo "  Project ID: ${PROJECT_ID}"
echo "  Project Name: ${PROJECT_NAME}"
echo "  Account: ${ACCOUNT}"
echo "  Region: ${REGION}"
echo ""

# Step 1: Authenticate
echo "Step 1: Authenticating with Google Cloud..."
gcloud auth login --account=${ACCOUNT}

# Set the account
gcloud config set account ${ACCOUNT}

# Step 2: Create project
echo ""
echo "Step 2: Creating GCP project..."
if gcloud projects describe ${PROJECT_ID} &>/dev/null; then
    echo "  Project ${PROJECT_ID} already exists. Skipping creation."
else
    echo "  Creating new project: ${PROJECT_ID}"
    gcloud projects create ${PROJECT_ID} \
        --name="${PROJECT_NAME}" \
        --set-as-default
    echo "  Project created successfully!"
fi

# Set the project as default
gcloud config set project ${PROJECT_ID}

echo ""
echo "Step 3: Linking billing account..."
echo "  Please link a billing account to this project in the GCP Console:"
echo "  https://console.cloud.google.com/billing/linkedaccount?project=${PROJECT_ID}"
echo ""
read -p "Press Enter once billing is linked to continue..."

# Step 4: Enable required APIs
echo ""
echo "Step 4: Enabling required Google Cloud APIs..."
echo "  This may take a few minutes..."

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

echo "  All required APIs enabled!"

# Step 5: Grant necessary permissions
echo ""
echo "Step 5: Setting up IAM permissions..."
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
    --member="user:${ACCOUNT}" \
    --role="roles/owner" \
    --no-user-output-enabled

echo "  Permissions configured!"

# Step 6: Create terraform.tfvars
echo ""
echo "Step 6: Creating Terraform configuration..."
cd "$(dirname "$0")/../terraform"

if [ -f "terraform.tfvars" ]; then
    echo "  terraform.tfvars already exists. Creating backup..."
    cp terraform.tfvars terraform.tfvars.backup
fi

cat > terraform.tfvars <<EOF
# GCP Project Configuration
project_id              = "${PROJECT_ID}"
region                  = "${REGION}"

# Gemini API Configuration
# Get your API key from: https://aistudio.google.com/apikey
gemini_api_key          = "REPLACE_WITH_YOUR_GEMINI_API_KEY"

# Application Configuration
cloud_run_service_name  = "valet-ticket-system"
signup_code             = ""  # Optional: leave empty for open signup after first user

# Database Configuration
db_tier                 = "db-f1-micro"  # Smallest tier (~$7.50/month)
# For better performance, use "db-g1-small" (~$25/month)

# Scaling Configuration
min_instances           = 0   # Scale to zero when not in use
max_instances           = 10  # Maximum concurrent instances
EOF

echo "  terraform.tfvars created!"
echo ""
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Get your Gemini API key from: https://aistudio.google.com/apikey"
echo "  2. Edit terraform/terraform.tfvars and add your Gemini API key"
echo "  3. Run the deployment:"
echo "     cd terraform"
echo "     terraform init"
echo "     terraform plan"
echo "     terraform apply"
echo ""
echo "Project Console: https://console.cloud.google.com/home/dashboard?project=${PROJECT_ID}"
echo ""
