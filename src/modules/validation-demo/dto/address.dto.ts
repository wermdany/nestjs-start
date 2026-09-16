import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class AddressDto {
  @IsString()
  @Length(2, 40)
  street: string;

  @IsString()
  @Length(2, 30)
  city: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{5,6}$/, { message: 'zip must be 5 to 6 digits' })
  zip?: string;
}
