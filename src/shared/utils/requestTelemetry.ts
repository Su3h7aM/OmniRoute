/**
 * Request Telemetry — FASE-09 E2E Hardening (T-45)
 *
 * Measures 7 phases of a request lifecycle and stores timings
 * for percentile calculations and monitoring.
 *
 * Phases: parse → validate → policy → resolve → connect → stream → finalize
 *
 * @module shared/utils/requestTelemetry
 */

const PHASES = ["parse", "validate", "policy", "resolve", "connect", "stream", "finalize"] as const;

type RequestPhase = (typeof PHASES)[number];

type PhaseTiming = {
	phase: string;
	startMs: number;
	endMs: number;
	durationMs: number;
	[key: string]: unknown;
};

type TelemetrySummary = {
	requestId: string;
	totalMs: number;
	phases: PhaseTiming[];
	recordedAt?: number;
};

function getPercentile(sorted: number[], percentile: number): number {
	if (sorted.length === 0) return 0;
	const index = Math.ceil((percentile / 100) * sorted.length) - 1;
	return sorted[Math.max(0, index)];
}

export class RequestTelemetry {
	requestId: string;
	startTime: number;
	phases: PhaseTiming[];
	private _currentPhase: string | null;
	private _phaseStart: number | null;

	constructor(requestId: string) {
		this.requestId = requestId;
		this.startTime = Date.now();
		this.phases = [];
		this._currentPhase = null;
		this._phaseStart = null;
	}

	/**
	 * Begin a phase measurement.
	 * @param {string} phase
	 */
	startPhase(phase: string) {
		if (this._currentPhase) {
			this.endPhase();
		}
		this._currentPhase = phase;
		this._phaseStart = Date.now();
	}

	/**
	 * End the current phase measurement.
	 * @param {Object} [metadata] - Additional metadata
	 */
	endPhase(metadata: Record<string, unknown> = {}) {
		if (!this._currentPhase || this._phaseStart === null) return;

		const now = Date.now();
		this.phases.push({
			phase: this._currentPhase,
			startMs: this._phaseStart - this.startTime,
			endMs: now - this.startTime,
			durationMs: now - this._phaseStart,
			...metadata,
		});

		this._currentPhase = null;
		this._phaseStart = null;
	}

	/**
	 * Convenience: measure an async function as a phase.
	 * @template T
	 * @param {string} phase
	 * @param {() => Promise<T>} fn
	 * @returns {Promise<T>}
	 */
	async measure<T>(phase: string, fn: () => Promise<T>): Promise<T> {
		this.startPhase(phase);
		try {
			const result = await fn();
			this.endPhase();
			return result;
		} catch (error: unknown) {
			this.endPhase({ error: error instanceof Error ? error.message : String(error) });
			throw error;
		}
	}

	/**
	 * Get the full telemetry summary.
	 * @returns {{ requestId: string, totalMs: number, phases: PhaseTiming[] }}
	 */
	getSummary(): TelemetrySummary {
		// Auto-end any open phase
		if (this._currentPhase) {
			this.endPhase();
		}

		return {
			requestId: this.requestId,
			totalMs: Date.now() - this.startTime,
			phases: [...this.phases],
		};
	}
}

// ─── Telemetry Aggregator ────────────────────────

const MAX_HISTORY = 1000;
const history: TelemetrySummary[] = [];

export function clearTelemetryHistory() {
	history.length = 0;
}

/**
 * Record a completed request's telemetry.
 * @param {RequestTelemetry} telemetry
 */
export function recordTelemetry(telemetry: RequestTelemetry): void {
	const summary = telemetry.getSummary();
	summary.recordedAt = Date.now();
	history.push(summary);
	while (history.length > MAX_HISTORY) {
		history.shift();
	}
}

export function getTelemetrySummary(windowMs = 300000): {
	count: number;
	p50: number;
	p95: number;
	p99: number;
	phaseBreakdown: Partial<
		Record<
			RequestPhase,
			{
				count: number;
				p50: number;
				p95: number;
				avg: number;
			}
		>
	>;
} {
	const cutoff = Date.now() - windowMs;
	const recent = history.filter((entry) => (entry.recordedAt || 0) >= cutoff);

	if (recent.length === 0) {
		return { count: 0, p50: 0, p95: 0, p99: 0, phaseBreakdown: {} };
	}

	const totals = recent.map((entry) => entry.totalMs).sort((a, b) => a - b);
	const phaseBreakdown: Partial<
		Record<
			RequestPhase,
			{
				count: number;
				p50: number;
				p95: number;
				avg: number;
			}
		>
	> = {};

	for (const phase of PHASES) {
		const durations = recent
			.flatMap((entry) =>
				entry.phases
					.filter((phaseTiming) => phaseTiming.phase === phase)
					.map((phaseTiming) => phaseTiming.durationMs)
			)
			.sort((a, b) => a - b);

		if (durations.length === 0) continue;

		phaseBreakdown[phase] = {
			count: durations.length,
			p50: getPercentile(durations, 50),
			p95: getPercentile(durations, 95),
			avg: Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length),
		};
	}

	return {
		count: recent.length,
		p50: getPercentile(totals, 50),
		p95: getPercentile(totals, 95),
		p99: getPercentile(totals, 99),
		phaseBreakdown,
	};
}

export { PHASES };
