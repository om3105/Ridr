import { createApp } from './app.js';
import { readConfig } from './config.js';
import { OperationalLogger } from './logging.js';

const logger = new OperationalLogger();

try {
  const config = readConfig(process.env);
  const app = await createApp(config);
  try {
    await app.listen(config.port, config.host);
  } catch (error) {
    await app.close();
    throw error;
  }
  logger.write('api_started', { environment: config.environment, port: config.port });
} catch {
  // Keep connection strings and framework error payloads out of operational logs.
  logger.write('api_start_failed');
  process.exitCode = 1;
}
