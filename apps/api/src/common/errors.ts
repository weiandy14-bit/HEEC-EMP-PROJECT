import { HttpException, HttpStatus } from '@nestjs/common';

/** 錯誤分類（§8 錯誤 envelope）。 */
export type ErrorCategory =
  | 'validation'
  | 'authorization'
  | 'conflict'
  | 'not_found'
  | 'scheduling'
  | 'import'
  | 'infrastructure';

export interface ErrorEnvelope {
  code: string;
  category: ErrorCategory;
  message: string;
  fields?: Record<string, string[]>;
  correlation_id?: string;
  retryable: boolean;
}

const STATUS_BY_CATEGORY: Record<ErrorCategory, HttpStatus> = {
  validation: HttpStatus.UNPROCESSABLE_ENTITY,
  authorization: HttpStatus.FORBIDDEN,
  conflict: HttpStatus.CONFLICT,
  not_found: HttpStatus.NOT_FOUND,
  scheduling: HttpStatus.UNPROCESSABLE_ENTITY,
  import: HttpStatus.UNPROCESSABLE_ENTITY,
  infrastructure: HttpStatus.SERVICE_UNAVAILABLE,
};

/** 領域錯誤：攜帶分類、代碼與是否可重試。 */
export class DomainError extends HttpException {
  constructor(
    public readonly category: ErrorCategory,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string[]>,
    status?: HttpStatus,
  ) {
    super(message, status ?? STATUS_BY_CATEGORY[category]);
  }

  static notFound(what: string): DomainError {
    return new DomainError('not_found', 'not_found', `${what}不存在`);
  }
  static conflict(code: string, message: string): DomainError {
    return new DomainError('conflict', code, message);
  }
  static validation(message: string, fields?: Record<string, string[]>): DomainError {
    return new DomainError('validation', 'validation_failed', message, fields);
  }
  static scheduling(message: string, fields?: Record<string, string[]>): DomainError {
    return new DomainError('scheduling', 'scheduling_conflict', message, fields);
  }
  static forbidden(message = '權限不足'): DomainError {
    return new DomainError('authorization', 'forbidden', message);
  }
}

export function isRetryable(category: ErrorCategory): boolean {
  return category === 'infrastructure';
}
