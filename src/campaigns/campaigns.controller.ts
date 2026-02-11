// src/campaigns/campaigns.controller.ts
import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import {
  PrepareCampaignDto,
  ConfirmCampaignDto,
  CloseCampaignDto,
  RecordPurchaseDto,
} from './campaigns.types';

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

  // campaigns.controller.ts
  @Get(':id/history')
  getHistory(@Param('id') id: string) {
    return this.campaignsService.getHistory(id);
  }

  // campaigns.controller.ts
  @Get(':id/analytics')
  getAnalytics(@Param('id') id: string) {
    return this.campaignsService.getAnalytics(id);
  }

  // campaigns.controller.ts
  @Post(':id/close')
  closeCampaign(@Param('id') id: string, @Body() dto: CloseCampaignDto) {
    return this.campaignsService.closeCampaign(id, dto.signature);
  }

  @Post(':id/purchase')
  recordPurchase(@Param('id') id: string, @Body() dto: RecordPurchaseDto) {
    return this.campaignsService.recordPurchase(id, dto);
  }

  @Get('')
  findAll() {
    return this.campaignsService.findAll();
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
