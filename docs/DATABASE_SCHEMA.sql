-- SCHEMA CƠ SỞ DỮ LIỆU CHO HỆ THỐNG TẠO ĐỀ THI TRẮC NGHIỆM AI
-- Tối ưu cho PostgreSQL 16+

-- gen_random_uuid() có sẵn từ PostgreSQL 13 và cả trong PGlite (không cần extension).

-- 1. BẢNG MÔN HỌC
CREATE TABLE IF NOT EXISTS subjects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. BẢNG TÀI LIỆU HỌC TẬP (DOCUMENTS)
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
    original_filename VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    page_count INT DEFAULT 0,
    extracted_text_length INT DEFAULT 0,
    status VARCHAR(30) DEFAULT 'PROCESSED' CHECK (status IN ('UPLOADED', 'PARSING', 'PROCESSED', 'FAILED')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. BẢNG CÂU HỎI TRẮC NGHIỆM (QUESTIONS)
CREATE TABLE IF NOT EXISTS questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    content TEXT NOT NULL,
    difficulty VARCHAR(20) NOT NULL CHECK (difficulty IN ('EASY', 'MEDIUM', 'HARD')),
    explanation TEXT NOT NULL,
    source_reference VARCHAR(255),
    -- Loại câu hỏi: MCQ, MULTI_SELECT, TRUE_FALSE, FILL_BLANK, MATCHING, ORDERING, LIKERT
    question_type VARCHAR(20) NOT NULL DEFAULT 'MCQ',
    -- Dữ liệu riêng theo loại (pairs của MATCHING, correctOrder của ORDERING, scale của LIKERT)
    payload JSONB,
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bổ sung cột cho CSDL đã tạo trước khi có tính năng nhiều loại câu hỏi.
-- CREATE TABLE IF NOT EXISTS không sửa được bảng cũ, nên phải ALTER riêng.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS question_type VARCHAR(20) NOT NULL DEFAULT 'MCQ';
ALTER TABLE questions ADD COLUMN IF NOT EXISTS payload JSONB;

-- 4. BẢNG ĐÁP ÁN LỰA CHỌN (QUESTION_OPTIONS)
CREATE TABLE IF NOT EXISTS question_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    option_label CHAR(1) NOT NULL CHECK (option_label IN ('A', 'B', 'C', 'D')),
    content TEXT NOT NULL,
    is_correct BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_question_option UNIQUE (question_id, option_label)
);

-- 5. BẢNG ĐỀ THI / BỘ ĐỀ (QUIZZES)
CREATE TABLE IF NOT EXISTS quizzes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    subject_id UUID NOT NULL REFERENCES subjects(id),
    mode VARCHAR(20) NOT NULL CHECK (mode IN ('PRACTICE', 'EXAM')),
    time_limit_seconds INT NOT NULL DEFAULT 1800,
    total_questions INT NOT NULL CHECK (total_questions BETWEEN 1 AND 100),
    -- TRUE = hiện đáp án đúng + giải thích ngay sau mỗi câu (chế độ luyện tập)
    instant_feedback BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS instant_feedback BOOLEAN NOT NULL DEFAULT TRUE;

-- 6. BẢNG GẮN CÂU HỎI VÀO ĐỀ THI (QUIZ_QUESTIONS)
CREATE TABLE IF NOT EXISTS quiz_questions (
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    display_order INT NOT NULL,
    PRIMARY KEY (quiz_id, question_id)
);

-- 7. BẢNG LƯỢT LÀM BÀI (QUIZ_ATTEMPTS)
CREATE TABLE IF NOT EXISTS quiz_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL,
    status VARCHAR(20) DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'SUBMITTED', 'TIMED_OUT')),
    total_questions INT NOT NULL,
    correct_count INT DEFAULT 0,
    score_percentage DECIMAL(5, 2) DEFAULT 0.00,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    -- NULL = không giới hạn thời gian (chế độ Ôn tập / PRACTICE)
    expires_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    CONSTRAINT chk_attempt_score CHECK (score_percentage BETWEEN 0 AND 100),
    CONSTRAINT chk_attempt_correct CHECK (correct_count >= 0 AND correct_count <= total_questions)
);

-- 8. BẢNG ĐÁP ÁN ĐÃ CHỌN CỦA TỪNG CÂU (ATTEMPT_ANSWERS)
CREATE TABLE IF NOT EXISTS attempt_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES questions(id),
    selected_option_id UUID REFERENCES question_options(id),
    -- Câu trả lời dạng phức tạp: chọn nhiều (mảng option id), điền khuyết (chuỗi),
    -- ghép đôi (map nhãn trái -> nhãn phải), sắp xếp (mảng nhãn).
    response JSONB,
    is_correct BOOLEAN DEFAULT FALSE,
    answered_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_attempt_question UNIQUE (attempt_id, question_id)
);

ALTER TABLE attempt_answers ADD COLUMN IF NOT EXISTS response JSONB;

-- CHIẾN LƯỢC TỐI ƯU INDEXES (DATABASE OPTIMIZATION)
CREATE INDEX IF NOT EXISTS idx_questions_query_pool 
ON questions (subject_id, difficulty) 
WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_options_question_fk ON question_options (question_id);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_quiz_fk ON quiz_questions (quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_question_fk ON quiz_questions (question_id);
CREATE INDEX IF NOT EXISTS idx_attempt_answers_attempt_fk ON attempt_answers (attempt_id);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_history 
ON quiz_attempts (user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_active_timeout
ON quiz_attempts (expires_at)
WHERE status = 'IN_PROGRESS';

-- Một môn học chỉ có một tên (không phân biệt hoa/thường) để tránh sinh trùng khi hai request đồng thời
CREATE UNIQUE INDEX IF NOT EXISTS uq_subjects_name_lower ON subjects (lower(name));
