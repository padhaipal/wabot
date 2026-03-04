import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const port = Number.parseInt(process.env.PORT ?? '3000', 10);

  await app.listen(port, '0.0.0.0');
  console.log(`Listening on ${port}`);
}

void bootstrap();
