#!/bin/bash
set -e

echo "[1/3] Fetching latest code from origin"
git fetch origin
git reset --hard origin/main

echo "[2/3] Stopping existing containers"
docker compose down

echo "[3/3] Building and starting new containers"
docker compose up -d --build

echo "Update completed! Service is running in the background."