# AWSTail

Stream CloudWatch Logs in (near) real-time with beautiful formatting.

## Usage

```bash
npx awstail --log-group <log-group> [options]
```

### Examples

```bash
# Stream logs from a Lambda function
npx awstail --log-group /aws/lambda/myFunction --profile my-profile --region us-east-1

# Filter for errors only
npx awstail --log-group /aws/lambda/myFunction --filter "ERROR" --since 30m

# Continuously tail logs (like tail -f)
npx awstail --log-group /aws/lambda/myFunction --tail --poll 2

# Get logs from the last hour
npx awstail --log-group /aws/lambda/myFunction --since 1h
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--log-group` | CloudWatch log group name (e.g. `/aws/lambda/myFunction`) | Required |
| `--profile` | AWS profile to use (overrides AWS_PROFILE env var) | - |
| `--region` | AWS region | `us-east-1` |
| `--filter` | Filter pattern (e.g. `ERROR`, `WARN`) | - |
| `--since` | Start time relative to now (e.g. `10s`, `22m`, `2h`, `1d`) | `10m` |
| `--poll` | Polling interval in seconds for tailing | `1` |
| `--tail` | Stream logs continuously (like `tail -f`) | `false` |

## Features

- **Beautiful formatting**: Color-coded output with request IDs, log levels, and timestamps
- **Real-time streaming**: Continuously monitor logs as they arrive
- **Smart filtering**: Built-in patterns for common log types
- **Error highlighting**: Automatically highlights error keywords and numbers
- **AWS integration**: Uses your existing AWS credentials and profiles

## AWS Authentication

The tool uses standard AWS credential resolution:
- Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
- AWS credentials file (`~/.aws/credentials`)
- AWS SSO
- IAM roles (when running on EC2)

## Requirements

- Node.js 18 or higher
- AWS credentials configured

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev -- --log-group /aws/lambda/myFunction

# Build for production
npm run build

# Watch mode for development
npm run build:watch
```

## License

MIT 