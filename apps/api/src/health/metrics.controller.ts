import { Controller, Get, Header } from '@nestjs/common';
import { metrics } from '../common/metrics';

/** Prometheus 指標端點（純文字）。正式環境建議置於內網或加保護。 */
@Controller({ path: 'metrics', version: '1' })
export class MetricsController {
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  scrape(): string {
    return metrics.render();
  }
}
