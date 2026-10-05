"""Publicação assíncrona de eventos de leitura de placa via Redis Streams.

Redis Streams (em vez de RabbitMQ) para manter a infra mínima: já usamos Redis
como dependência leve, streams dão persistência + consumer groups (o Fixer core
pode processar com múltiplos workers e retomar de onde parou), sem precisar
operar um broker separado. Trocar para RabbitMQ/Kafka depois só exige reimplementar
esta interface — o resto do serviço não conhece o transporte.
"""

from abc import ABC, abstractmethod

import redis.asyncio as redis

from app.core.config import settings
from app.core.logging import get_logger
from app.models.schemas import PlateEvent

logger = get_logger(__name__)


class EventPublisher(ABC):
    @abstractmethod
    async def publish(self, event: PlateEvent) -> None:
        raise NotImplementedError

    async def close(self) -> None:
        return None


class RedisStreamPublisher(EventPublisher):
    def __init__(self) -> None:
        self._client = redis.from_url(settings.redis_url, decode_responses=True)

    async def publish(self, event: PlateEvent) -> None:
        payload = {"data": event.model_dump_json()}
        await self._client.xadd(
            settings.redis_stream_name,
            payload,
            maxlen=settings.redis_stream_maxlen,
            approximate=True,
        )
        logger.info(
            "plate_event_published",
            request_id=event.request_id,
            location_id=event.location_id,
            plate=event.result.plate,
            status=event.result.status,
        )

    async def close(self) -> None:
        await self._client.aclose()


_publisher: EventPublisher | None = None


def get_publisher() -> EventPublisher:
    global _publisher
    if _publisher is None:
        _publisher = RedisStreamPublisher()
    return _publisher
