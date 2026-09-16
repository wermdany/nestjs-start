import { Module } from '@nestjs/common';
import { ValidationDemoController } from './validation-demo.controller';
import { ValidationDemoService } from './validation-demo.service';
import { ValidationPipeOrderController } from './validation-pipe-order.controller';

@Module({
  controllers: [ValidationDemoController, ValidationPipeOrderController],
  providers: [ValidationDemoService],
})
export class ValidationDemoModule {}
