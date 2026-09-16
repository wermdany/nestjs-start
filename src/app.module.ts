import { Module } from '@nestjs/common';
import { ValidationDemoModule } from '@/modules/validation-demo/validation-demo.module';
import { ApiContractModule } from '@/contract';

@Module({
  imports: [ApiContractModule.forRoot(), ValidationDemoModule],
})
export class AppModule {}
