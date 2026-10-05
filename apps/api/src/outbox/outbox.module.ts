import { Module } from '@nestjs/common';
import { OutboxRelay } from './outbox-relay.service.js';

@Module({ providers: [OutboxRelay] })
export class OutboxModule {}
