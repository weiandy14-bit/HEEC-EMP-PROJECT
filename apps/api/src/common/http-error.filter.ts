import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError, ErrorEnvelope, isRetryable, type ErrorCategory } from './errors';

/** 將所有例外轉為統一錯誤 envelope（§8）。詳細堆疊只進受控日誌。 */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const correlationId = (req as any).correlationId as string | undefined;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let envelope: ErrorEnvelope;

    if (exception instanceof DomainError) {
      status = exception.getStatus();
      envelope = {
        code: exception.code,
        category: exception.category,
        message: exception.message,
        fields: exception.fields,
        correlation_id: correlationId,
        retryable: isRetryable(exception.category),
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const category = categoryFromStatus(status);
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : ((body as any)?.message ?? exception.message);
      envelope = {
        code: httpCode(status),
        category,
        message: Array.isArray(message) ? message.join('; ') : String(message),
        fields: extractFields(body),
        correlation_id: correlationId,
        retryable: isRetryable(category),
      };
    } else {
      // 未預期錯誤：不外洩堆疊
      // eslint-disable-next-line no-console
      console.error('[unhandled]', correlationId, exception);
      envelope = {
        code: 'internal_error',
        category: 'infrastructure',
        message: '伺服器內部錯誤',
        correlation_id: correlationId,
        retryable: true,
      };
    }

    res.status(status).json(envelope);
  }
}

function categoryFromStatus(status: number): ErrorCategory {
  if (status === 401 || status === 403) return 'authorization';
  if (status === 404) return 'not_found';
  if (status === 409 || status === 412) return 'conflict';
  if (status === 400 || status === 422) return 'validation';
  if (status >= 500) return 'infrastructure';
  return 'validation';
}

function httpCode(status: number): string {
  const map: Record<number, string> = {
    400: 'bad_request',
    401: 'unauthorized',
    403: 'forbidden',
    404: 'not_found',
    409: 'conflict',
    412: 'precondition_failed',
    422: 'unprocessable_entity',
    503: 'service_unavailable',
  };
  return map[status] ?? 'error';
}

function extractFields(body: unknown): Record<string, string[]> | undefined {
  if (body && typeof body === 'object' && Array.isArray((body as any).message)) {
    return { _: (body as any).message as string[] };
  }
  return undefined;
}
