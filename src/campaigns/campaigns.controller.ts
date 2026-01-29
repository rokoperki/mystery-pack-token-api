// src/campaigns/campaigns.controller.ts
import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { PrepareCampaignDto, ConfirmCampaignDto } from './campaigns.types';

@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Post('prepare')
  prepare(@Body() dto: PrepareCampaignDto) {
    return this.campaignsService.prepare(dto);
  }

  @Post(':id/confirm')
  confirm(@Param('id') id: string, @Body() dto: ConfirmCampaignDto) {
    return this.campaignsService.confirm(id, dto.signature);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.campaignsService.findOne(id);
  }

  @Get(':id/reveal/:packIndex')
  getReveal(
    @Param('id') id: string,
    @Param('packIndex') packIndex: string,
    @Query('wallet') wallet: string,
  ) {
    return this.campaignsService.getReveal(id, parseInt(packIndex), wallet);
  }
}
