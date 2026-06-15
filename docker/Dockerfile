FROM node:24-alpine

RUN apk add --no-cache git bash

RUN corepack enable && corepack prepare pnpm@10 --activate

RUN git config --global user.email "test@test.com" && \
    git config --global user.name "Test User" && \
    git config --global init.defaultBranch main

WORKDIR /build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY src/ src/
COPY tsc/ tsc/
COPY rollup-plugins/ rollup-plugins/
COPY github_actions_examples/ github_actions_examples/
COPY .claude/skills/cc-pr-review-ci/ .claude/skills/cc-pr-review-ci/
COPY build.ts rollup.config.ts reset.d.ts ./

RUN pnpm install --frozen-lockfile && node build.ts && pnpm pack

RUN mkdir -p /workspace /test-projects && cp -r /build/src /workspace/src

WORKDIR /workspace

ENTRYPOINT ["/bin/bash"]