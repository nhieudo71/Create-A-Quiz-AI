export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Dữ liệu yêu cầu không hợp lệ') {
    super(message, 400);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Chưa xác thực danh tính') {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Không có quyền truy cập') {
    super(message, 403);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Yêu cầu xung đột với trạng thái hiện tại') {
    super(message, 409);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Không tìm thấy tài nguyên yêu cầu') {
    super(message, 404);
  }
}
