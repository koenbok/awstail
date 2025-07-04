/**
 * Stream CloudWatch Logs in (near) real-time.
 *
 *   $ npx tsx src/index.ts --log-group /aws/lambda/myFunction --profile lambda-sub --filter "ERROR" --region us-east-1 --poll 1 --since 10m
 *
 * ENVIRONMENT
 * ───────────
 *   AWS credentials must be available through the usual mechanisms
 *   (env vars, shared-credentials file, SSO, IAM role, …).
 *
 * BUILD/RUN
 * ─────────
 *   npm i -D @aws-sdk/client-cloudwatch-logs cleye
 *   npx tsx src/index.ts --log-group <log-group> [--profile <aws-profile>] [--filter <pattern>] [--region <aws-region>] [--poll <seconds>] [--since <time>]
 */
import { cli } from "cleye";
import { exit } from "node:process";
import { createInterface, Interface } from "node:readline";
import { stdin, stdout } from "node:process";
import type {
	FilterLogEventsCommandInput,
	FilteredLogEvent,
} from "@aws-sdk/client-cloudwatch-logs";
import {
	CloudWatchLogsClient,
	FilterLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";

const argv = cli({
	name: "stream-logs",
	help: {
		description: "Stream CloudWatch Logs in (near) real-time.",
		usage: [
			"npx tsx src/index.ts --log-group <log-group> [--profile <aws-profile>] [--filter <pattern>] [--region <aws-region>] [--poll <seconds>] [--since <time>] [--tail]",
		],
	},
	flags: {
		logGroup: {
			type: String,
			description: "CloudWatch log group name (e.g. /aws/lambda/myFunction)",
			required: true,
		},
		profile: {
			type: String,
			description: "AWS profile to use (overrides AWS_PROFILE env var)",
		},
		filter: {
			type: String,
			description: "Filter pattern (e.g. ERROR)",
		},
		region: {
			type: String,
			description: "AWS region (default: us-east-1)",
			default: process.env.AWS_REGION ?? "us-east-1",
		},
		poll: {
			type: Number,
			description: "Polling interval in seconds (default: 1)",
			default: 1,
		},
		since: {
			type: String,
			description: "Start time relative to now (e.g. 10s, 22m, 2h, 1d)",
			default: "10m",
		},
		tail: {
			type: Boolean,
			description:
				"Stream logs continuously (default: false, fetch once and exit)",
			default: false,
		},
	},
});

interface Options {
	logGroup: string;
	region: string;
	filterPattern?: string;
	pollMs: number;
	startTime: number;
	tail: boolean;
}

interface FilterState {
	pattern: string;
	isActive: boolean;
}

class InteractiveFilter {
	private filterState: FilterState = { pattern: "", isActive: false };
	private readline: Interface;

	constructor() {
		this.setupReadline();
	}

	private setupReadline() {
		this.readline = createInterface({
			input: stdin,
			output: stdout,
		});

		// Enable raw mode to capture individual keystrokes
		if (stdin.isTTY) {
			stdin.setRawMode(true);
		}

		stdin.on("data", (key) => {
			this.handleKeyPress(key);
		});
	}

	private handleKeyPress(key: Buffer) {
		const keyStr = key.toString();

		// Handle special keys
		if (keyStr === "\u0003") {
			// Ctrl+C
			this.cleanup();
			process.exit(0);
		} else if (keyStr === "\u007f" || keyStr === "\b") {
			// Backspace
			this.handleBackspace();
		} else if (keyStr === "\u001b[3~") {
			// Delete
			this.handleDelete();
		} else if (keyStr === "\u001b") {
			// Escape
			this.clearFilter();
		} else if (keyStr.length === 1 && keyStr >= " " && keyStr <= "~") {
			// Printable characters
			this.addToFilter(keyStr);
		}
	}

	private addToFilter(char: string) {
		this.filterState.pattern += char;
		this.filterState.isActive = true;
		this.updateStatusLine();
	}

	private handleBackspace() {
		if (this.filterState.pattern.length > 0) {
			this.filterState.pattern = this.filterState.pattern.slice(0, -1);
			if (this.filterState.pattern.length === 0) {
				this.filterState.isActive = false;
			}
			this.updateStatusLine();
		}
	}

	private handleDelete() {
		// For now, same as backspace
		this.handleBackspace();
	}

	private clearFilter() {
		this.filterState.pattern = "";
		this.filterState.isActive = false;
		this.updateStatusLine();
	}

	private updateStatusLine() {
		// Clear the current line and show the filter status
		process.stdout.write("\r\x1b[K");
		if (this.filterState.isActive) {
			process.stdout.write(
				`${colors.gray}${colors.dim}filter: ${this.filterState.pattern}${colors.reset}`,
			);
		}
		// Don't show "Last fetch at" line anymore - it's too noisy
	}

	shouldDimLine(message: string): boolean {
		if (!this.filterState.isActive || this.filterState.pattern === "") {
			return false;
		}
		return !message
			.toLowerCase()
			.includes(this.filterState.pattern.toLowerCase());
	}

	getDimmedLine(formatted: string): string {
		// Apply super dim formatting - make it much less visible
		// Strip ANSI escape codes and apply dim formatting
		const stripped = formatted.replace(/\u001b\[[0-9;]*m/g, "");
		return `${colors.gray}${colors.dim}${stripped}${colors.reset}`;
	}

	getFilterPattern(): string {
		return this.filterState.pattern;
	}

	isFilterActive(): boolean {
		return this.filterState.isActive;
	}

	cleanup() {
		if (stdin.isTTY) {
			stdin.setRawMode(false);
		}
		this.readline.close();
	}
}

// ANSI color codes
const colors = {
	reset: "\x1b[0m",
	dim: "\x1b[2m",
	bright: "\x1b[1m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	white: "\x1b[37m",
	gray: "\x1b[90m",
	orange: "\x1b[38;5;214m",
};

/** Parse time format like 10s, 22m, 2h, 1d into milliseconds */
function parseTimeFormat(timeStr: string): number {
	const match = timeStr.match(/^(\d+)([smhd])$/);
	if (!match) {
		throw new Error(
			`Invalid time format: ${timeStr}. Use formats like: 10s, 22m, 2h, 1d`,
		);
	}

	const [, amount, unit] = match;
	const num = Number.parseInt(amount, 10);

	const multipliers = {
		s: 1000, // seconds
		m: 60 * 1000, // minutes
		h: 60 * 60 * 1000, // hours
		d: 24 * 60 * 60 * 1000, // days
	};

	return num * multipliers[unit as keyof typeof multipliers];
}

/** Extract request ID from log message */
function extractRequestId(message: string): string {
	// First try to find "RequestId: uuid" pattern
	let match = message.match(/RequestId: ([a-f0-9-]+)/);
	if (match) {
		return match[1].slice(0, 6);
	}

	// If not found, try to extract from the UUID in the message (Lambda format)
	match = message.match(
		/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/,
	);
	if (match) {
		return match[1].slice(0, 6);
	}

	return "------";
}

/** Extract log level from message */
function extractLogLevel(message: string): string {
	if (message.includes("ERROR")) return "ERR";
	if (message.includes("WARN")) return "WRN";
	if (message.includes("INFO")) return "INF";
	if (message.includes("DEBUG")) return "DBG";
	if (message.includes("START RequestId:")) return "STR";
	if (message.includes("END RequestId:")) return "END";
	if (message.includes("REPORT RequestId:")) return "RPT";
	if (message.includes("INIT_START")) return "INI";
	return "   ";
}

/** Get color for request ID (consistent per ID) */
function getRequestIdColor(requestId: string): string {
	const colors_list = [
		colors.cyan,
		colors.green,
		colors.yellow,
		colors.magenta,
		colors.blue,
	];
	const hash = requestId
		.split("")
		.reduce((acc, char) => acc + char.charCodeAt(0), 0);
	return colors_list[hash % colors_list.length];
}

/** Get color for log level */
function getLogLevelColor(level: string): string {
	switch (level.trim()) {
		case "ERR":
			return colors.red;
		case "WRN":
			return colors.yellow;
		case "INF":
			return colors.green;
		case "DBG":
			return colors.blue;
		case "STR":
			return colors.cyan;
		case "END":
			return colors.cyan;
		case "RPT":
			return colors.magenta;
		case "INI":
			return colors.bright + colors.cyan;
		default:
			return colors.gray;
	}
}

/** Highlight numbers in text */
function highlightNumbers(text: string): string {
	return text.replace(
		/\b(\d+(?:\.\d+)?)([a-zA-Z]{1,3})?\b/g,
		`${colors.cyan}$1${colors.reset}${colors.dim}$2`,
	);
}

/** Highlight error/failure keywords in text */
function highlightErrorKeywords(text: string): string {
	return text.replace(
		/\b\w*(?:fail|err)\w*\b/gi,
		`${colors.orange}$&${colors.reset}${colors.dim}`,
	);
}

/** Check if message contains error/failure keywords */
function containsErrorKeywords(message: string): boolean {
	const lowerMessage = message.toLowerCase();
	return lowerMessage.includes("fail") || lowerMessage.includes("err");
}

/** Format log entry */
function formatLogEntry(timestamp: number, message: string): string {
	const localTime = new Date(timestamp).toLocaleTimeString("en-US", {
		hour12: false,
	});
	const requestId = extractRequestId(message);
	const logLevel = extractLogLevel(message);

	const requestIdColor = getRequestIdColor(requestId);
	const logLevelColor = getLogLevelColor(logLevel);

	// Clean up the message by removing redundant information
	const cleanMessage = message
		.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\s+/, "") // Remove timestamp at start
		.replace(
			/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\s+/,
			"",
		) // Remove full UUID
		.replace(/RequestId: [a-f0-9-]+\s*/, "") // Remove RequestId prefix
		.replace(/Version: \$LATEST\s*/, "") // Remove version
		.replace(/START RequestId:\s*$/, "") // Remove empty START
		.replace(/END RequestId:\s*$/, "") // Remove empty END
		.replace(/REPORT RequestId:\s*/, "") // Remove REPORT prefix
		.replace(/INFO\s+/, "") // Remove redundant INFO
		.replace(/ERROR\s+/, "") // Remove redundant ERROR
		.replace(/WARN\s+/, "") // Remove redundant WARN
		.replace(/DEBUG\s+/, "") // Remove redundant DEBUG
		.replace(/\s+/g, " ") // Convert any sequence of whitespace to single space
		.trim();

	// Highlight numbers in the message
	let highlightedMessage = highlightNumbers(cleanMessage);

	// Highlight error keywords in the message
	highlightedMessage = highlightErrorKeywords(highlightedMessage);

	// Normal formatting (no special line highlighting)
	return `${colors.gray}${localTime}${colors.reset} ${requestIdColor}${requestId}${colors.reset} ${logLevelColor}${logLevel}${colors.reset} ${colors.dim}${highlightedMessage}${colors.reset}`;
}

/** Fetch logs once from CloudWatch */
async function fetchLogs(
	client: CloudWatchLogsClient,
	logGroupName: string,
	{ filterPattern, startTime }: Pick<Options, "filterPattern" | "startTime">,
): Promise<FilteredLogEvent[]> {
	const params: FilterLogEventsCommandInput = {
		logGroupName,
		interleaved: true,
		startTime,
		filterPattern,
		limit: 10_000,
	};

	const events: FilteredLogEvent[] = [];
	let nextToken: string | undefined;

	// Fetch all available events
	do {
		const response = await client.send(
			new FilterLogEventsCommand({ ...params, nextToken }),
		);
		if (response.events?.length) {
			events.push(...response.events);
		}
		nextToken = response.nextToken;
	} while (nextToken);

	return events;
}

/** Stream new logs continuously */
async function* streamLogs(
	client: CloudWatchLogsClient,
	logGroupName: string,
	{
		filterPattern,
		pollMs,
		startTime,
	}: Pick<Options, "filterPattern" | "pollMs" | "startTime">,
	interactiveFilter?: InteractiveFilter,
) {
	let currentStartTime = startTime;

	while (true) {
		const params: FilterLogEventsCommandInput = {
			logGroupName,
			interleaved: true,
			startTime: currentStartTime,
			filterPattern,
			limit: 10_000,
		};

		const { events } = await client.send(new FilterLogEventsCommand(params));

		if (events?.length) {
			currentStartTime = Math.max(...events.map((e) => e.timestamp ?? 0)) + 1;
			for (const event of events) {
				yield event;
			}
		}

		await new Promise((r) => setTimeout(r, pollMs));
	}
}

async function main() {
	// Set AWS profile if provided
	if (argv.flags.profile) {
		process.env.AWS_PROFILE = argv.flags.profile;
	}

	// Validate required fields
	if (!argv.flags.logGroup) {
		console.error("Missing required --log-group argument.");
		exit(1);
	}

	// Parse since time (now has default of "10m")
	let startTime: number;
	try {
		const sinceMs = parseTimeFormat(argv.flags.since);
		startTime = Date.now() - sinceMs;
	} catch (error) {
		console.error(`Error parsing --since: ${error.message}`);
		exit(1);
	}

	const opts: Options = {
		logGroup: argv.flags.logGroup,
		region: argv.flags.region,
		filterPattern: argv.flags.filter,
		pollMs: argv.flags.poll * 1000, // Convert seconds to milliseconds
		startTime,
		tail: argv.flags.tail,
	};

	const client = new CloudWatchLogsClient({ region: opts.region });

	// Create interactive filter if in tail mode
	let interactiveFilter: InteractiveFilter | undefined;
	if (opts.tail) {
		interactiveFilter = new InteractiveFilter();

		// Set up cleanup on exit
		process.on("SIGINT", () => {
			interactiveFilter?.cleanup();
			process.exit(0);
		});

		process.on("SIGTERM", () => {
			interactiveFilter?.cleanup();
			process.exit(0);
		});
	}

	// First, fetch existing logs
	const initialEvents = await fetchLogs(client, opts.logGroup, opts);

	if (initialEvents.length === 0) {
		console.log(
			`${colors.dim}No logs found in the last ${argv.flags.since}${colors.reset}`,
		);
	} else {
		// Display initial events
		for (const event of initialEvents) {
			const formatted = formatLogEntry(
				event.timestamp ?? 0,
				event.message ?? "",
			);
			console.log(formatted);
		}
	}

	// If tailing, continue streaming from current time
	if (opts.tail) {
		const streamStartTime =
			initialEvents.length > 0
				? Math.max(...initialEvents.map((e) => e.timestamp ?? 0)) + 1
				: Date.now();

		for await (const event of streamLogs(
			client,
			opts.logGroup,
			{
				...opts,
				startTime: streamStartTime,
			},
			interactiveFilter,
		)) {
			const formatted = formatLogEntry(
				event.timestamp ?? 0,
				event.message ?? "",
			);

			if (interactiveFilter) {
				// Clear the status line before showing the log
				process.stdout.write("\r\x1b[K");

				// Display the line with appropriate formatting
				const shouldDim = interactiveFilter.shouldDimLine(event.message ?? "");

				if (shouldDim) {
					// Apply super dim formatting
					const dimmed = interactiveFilter.getDimmedLine(formatted);
					console.log(dimmed);
				} else {
					console.log(formatted);
				}

				// Update the status line only if filter is active
				if (interactiveFilter.isFilterActive()) {
					process.stdout.write(
						`${colors.gray}${colors.dim}filter: ${interactiveFilter.getFilterPattern()}${colors.reset}`,
					);
				}
			} else {
				console.log(formatted);
			}
		}
	}
}

main().catch((err) => {
	console.error(err);
	exit(1);
});
