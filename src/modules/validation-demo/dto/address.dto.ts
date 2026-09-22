import { IsString, Length, Matches } from 'class-validator';
import { IsOptionalNotNull } from '@/contract';

export class AddressDto {
  @IsString()
  @Length(2, 40)
  street: string;

  @IsString()
  @Length(2, 30)
  city: string;

  // 可省，但 `"zip": null` 会被拒（`@IsOptional()` 会放行 null，见共享契约里的说明）。
  @IsOptionalNotNull()
  @IsString()
  @Matches(/^\d{5,6}$/, { message: 'zip must be 5 to 6 digits' })
  zip?: string;
}
