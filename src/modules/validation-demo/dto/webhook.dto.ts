import { Type } from 'class-transformer';
import { IsNumber, IsObject, IsString, Length } from 'class-validator';

/**
 * 真正带校验规则的 webhook 载荷。
 *
 * 它存在的意义是当「同一个 DTO」的对照物：
 * - `POST /validation-demo/webhooks/body` 用 `@Body()` ⇒ 走默认校验；
 * - `POST /validation-demo/webhooks/raw-body` 用 `@RawBody()` ⇒ 参数级豁免。
 *
 * 两处共用这一个类，所以**不需要**再定义一个同形状的 DTO。
 */
export class WebhookDto {
  @IsString()
  @Length(2, 40)
  event: string;

  @IsObject()
  data: Record<string, unknown>;

  @Type(() => Number)
  @IsNumber()
  count: number;
}
