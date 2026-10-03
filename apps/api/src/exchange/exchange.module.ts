import {Module} from '@nestjs/common';
import {ExchangeController} from './exchange.controller';
import {ExchangeService} from './exchange.service';
import {ExchangeStorage} from './storage';
@Module({controllers:[ExchangeController],providers:[ExchangeService,ExchangeStorage]})
export class ExchangeModule{}
