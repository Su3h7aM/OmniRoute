import { describe, it, expect, vi } from "bun:test";
import { render } from "@testing-library/react";
import React from "react";
import "@testing-library/jest-dom";
import CachePerformance from "../components/CachePerformance";

vi.mock("next-intl", () => ({
	useTranslations: () => (key: string) => key,
}));

describe("CachePerformance", () => {
	const defaultProps = {
		hits: 850,
		misses: 150,
		hitRate: "85.0%",
		avgLatencyMs: 45,
		p95LatencyMs: 120,
		totalRequests: 1000,
	};

	describe("renders with data", () => {
		it("renders hit count", () => {
			const { getByText } = render(<CachePerformance {...defaultProps} />);
			expect(getByText("850")).toBeInTheDocument();
		});

		it("renders miss count", () => {
			const { getByText } = render(<CachePerformance {...defaultProps} />);
			expect(getByText("150")).toBeInTheDocument();
		});

		it("renders hit rate percentage", () => {
			const { getAllByText } = render(<CachePerformance {...defaultProps} />);
			expect(getAllByText("85.0%").length).toBeGreaterThan(0);
		});

		it("renders total requests", () => {
			const { getByText } = render(<CachePerformance {...defaultProps} />);
			expect(getByText("1000")).toBeInTheDocument();
		});

		it("renders average latency", () => {
			const { getByText } = render(<CachePerformance {...defaultProps} />);
			expect(getByText("45")).toBeInTheDocument();
		});
	});

	describe("shows loading state", () => {
		it("renders skeleton when loading is true", () => {
			render(<CachePerformance {...defaultProps} loading={true} />);
			const skeletons = document.querySelectorAll("[data-testid='skeleton']");
			expect(skeletons.length).toBeGreaterThan(0);
		});

		it("hides values when loading", () => {
			const { queryByText } = render(<CachePerformance {...defaultProps} loading={true} />);
			expect(queryByText("850")).not.toBeInTheDocument();
		});

		it("shows values after loading completes", () => {
			const { getByText } = render(<CachePerformance {...defaultProps} loading={false} />);
			expect(getByText("850")).toBeInTheDocument();
		});
	});

	describe("handles empty state", () => {
		it("renders with zero hits and misses", () => {
			const { getAllByText } = render(
				<CachePerformance
					hits={0}
					misses={0}
					hitRate="0%"
					avgLatencyMs={0}
					p95LatencyMs={0}
					totalRequests={0}
				/>
			);
			expect(getAllByText("0").length).toBeGreaterThan(0);
		});

		it("renders gracefully when stats is null", () => {
			render(<CachePerformance stats={null} />);
		});

		it("renders component container even with no data", () => {
			render(<CachePerformance stats={null} />);
			const container = document.querySelector("[data-testid='cache-performance']");
			expect(container).toBeInTheDocument();
		});
	});

	describe("handles API errors", () => {
		it("displays error message", () => {
			const { getByText } = render(
				<CachePerformance {...defaultProps} error="Failed to load performance data" />
			);
			expect(getByText(/failed to load performance data/i)).toBeInTheDocument();
		});

		it("shows retry button on error state", () => {
			const { getByRole } = render(
				<CachePerformance {...defaultProps} error="Timeout" onRetry={vi.fn()} />
			);
			expect(getByRole("button", { name: /retry/i })).toBeInTheDocument();
		});

		it("invokes onRetry callback on click", () => {
			const onRetry = vi.fn();
			const { getByRole } = render(
				<CachePerformance {...defaultProps} error="Timeout" onRetry={onRetry} />
			);
			getByRole("button", { name: /retry/i }).click();
			expect(onRetry).toHaveBeenCalledOnce();
		});
	});
});
