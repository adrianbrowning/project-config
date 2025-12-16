# Docker image for testing @gingacodemonkey/config CLI
# Provides Node.js 24 + pnpm + git in an isolated environment

FROM node:24-alpine

# Install git and bash (required for husky, git hooks, and shell scripts)
RUN apk add --no-cache git bash

# Enable corepack and install pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

# Configure git for commits (required for testing husky/commitlint)
RUN git config --global user.email "test@test.com" && \
    git config --global user.name "Test User" && \
    git config --global init.defaultBranch main

# Create directories for package and test workspace
RUN mkdir -p /pkg /workspace /test-projects

# Set working directory
WORKDIR /workspace

# Copy package tarball (will be mounted or copied during build)
# COPY *.tgz /pkg/

# Default command
ENTRYPOINT ["/bin/bash"]
