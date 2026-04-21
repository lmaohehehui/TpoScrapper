# Use a Python image
FROM python:3.11-slim

WORKDIR /app

# Install Chromium and Driver
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-driver \
    && rm -rf /var/lib/apt/lists/*

# Set environment variables for Selenium
ENV CHROME_BIN=/usr/bin/chromium
ENV CHROMEDRIVER_PATH=/usr/bin/chromedriver
ENV PYTHONUNBUFFERED=1

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy everything
COPY . .

# Start the server using Render's $PORT variable
# Selenium scrapes can take longer than Gunicorn's default 30s timeout.
CMD gunicorn --bind 0.0.0.0:${PORT:-8000} --timeout 300 index:app
