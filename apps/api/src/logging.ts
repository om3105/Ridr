export type LogFields = Record<string, string | number | boolean | undefined>;
export type LogSink = (line: string) => void;

export class OperationalLogger {
  constructor(private readonly sink: LogSink = (line) => process.stdout.write(`${line}\n`)) {}

  write(event: string, fields: LogFields = {}): void {
    this.sink(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));
  }
}
