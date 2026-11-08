# ==============================================================================
# MULTI-STAGE DOCKERFILE CHO MEDQUIZ AI (Tao-Trac-Nghiem AI)
# Tối ưu hóa: Giảm dung lượng Image (<150MB), Tăng tốc độ Build với Cache Layers,
# và Bảo mật với Non-Root User.
# ==============================================================================

# ------------------------------------------------------------------------------
# STAGE 1: Build Client (React + Vite + Tailwind CSS)
# ------------------------------------------------------------------------------
FROM node:20-alpine AS client-builder
WORKDIR /app/client

# Cài đặt dependencies trước để tận dụng Docker Cache
COPY client/package*.json ./
RUN npm ci

# Copy toàn bộ mã nguồn frontend và tiến hành build production
COPY client/ ./
RUN npm run build

# ------------------------------------------------------------------------------
# STAGE 2: Build Backend (Fastify + TypeScript)
# ------------------------------------------------------------------------------
FROM node:20-alpine AS server-builder
WORKDIR /app

# Cài đặt dependencies cho backend
COPY package*.json tsconfig.json ./
# --ignore-scripts: bỏ qua bước tải binary Electron (không cần trong container)
RUN npm ci --ignore-scripts

# Copy mã nguồn backend và compile TypeScript sang JavaScript
COPY src/ ./src/
# Schema SQL nằm trong docs/: cần cho bước migrate lúc chạy và để chép sang stage runtime
COPY docs/ ./docs/
RUN npm run build

# Loại bỏ các devDependencies để tiết kiệm dung lượng
RUN npm prune --omit=dev

# ------------------------------------------------------------------------------
# STAGE 3: Production Runtime (Siêu nhẹ & Bảo mật)
# ------------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

# Thiết lập môi trường Production
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Tạo thư mục uploads và data (settings.json: cấu hình nhà cung cấp AI + khoá API,
# xem src/modules/settings/settings.store.ts — lưu độc lập khỏi DB để sao lưu CSDL
# không bao giờ chứa khoá API, nhưng vẫn cần ghi được xuống đĩa và tồn tại qua các lần redeploy)
RUN mkdir -p /app/uploads /app/data && chown -R node:node /app

# Copy production node_modules từ server-builder
COPY --from=server-builder --chown=node:node /app/node_modules ./node_modules
COPY --from=server-builder --chown=node:node /app/package*.json ./

# Copy compiled backend code
COPY --from=server-builder --chown=node:node /app/dist ./dist

# Schema SQL: src/core/database/migrate.ts đọc docs/DATABASE_SCHEMA.sql lúc khởi động
# và dừng tiến trình nếu không tìm thấy. Không có dòng này container sẽ crash ngay.
COPY --from=server-builder --chown=node:node /app/docs ./docs

# Copy static frontend assets vào client/dist (đúng đường dẫn mà src/app.ts phục vụ)
COPY --from=client-builder --chown=node:node /app/client/dist ./client/dist

# Chuyển sang non-root user 'node' để đảm bảo an ninh (Security Best Practice)
USER node

# Expose cổng ứng dụng
EXPOSE 3000

# Khởi chạy ứng dụng
CMD ["node", "dist/server.js"]
