import {Module} from '@nestjs/common';
import {ExchangeController} from './exchange.controller';
import {ExchangeInternalController} from './exchange.internal.controller';
import {ExchangeService} from './exchange.service';
import {ExchangeStorage} from './storage';
@Module({controllers:[ExchangeController,ExchangeInternalController],providers:[ExchangeService,ExchangeStorage]})
export class ExchangeModule{}
