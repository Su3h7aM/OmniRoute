import { describe, it, expect, vi } from "bun:test";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import MemoryCards from "../components/MemoryCards";

vi.mock("next-intl", () => ({
	useTranslations: () => (key: string) => key,
}));

describe("MemoryCards", () => {
	const defaultProps = {
		memoryEntries: 42,
		dbEntries: 120,
		hits: 300,
		misses: 50,
		hitRate: "85.7%",
		tokensSaved: 15000,
	};

	describe("renders with data", () => {
		it("renders memory entry count", () => {
			const { getByText } = render(<MemoryCards {...defaultProps} />);
			expect(getByText("42")).toBeInTheDocument();
		});

		it("renders db entry count", () => {
			const { getByText } = render(<MemoryCards {...defaultProps} />);
			expect(getByText("120")).toBeInTheDocument();
		});

		it("renders hit rate value", () => {
			const { getByText } = render(<MemoryCards {...defaultProps} />);
			expect(getByText("85.7%")).toBeInTheDocument();
		});

		it("renders tokens saved", () => {
			const { getByText } = render(<MemoryCards {...defaultProps} />);
			expect(getByText("15000")).toBeInTheDocument();
		});
	});

	describe("shows loading state", () => {
		it("renders skeleton loaders when loading prop is true", () => {
			render(<MemoryCards {...defaultProps} loading={true} />);
			const skeletons = document.querySelectorAll("[data-testid='skeleton']");
			expect(skeletons.length).toBeGreaterThan(0);
		});

		it("does not render stat values while loading", () => {
			const { queryByText } = render(<MemoryCards {...defaultProps} loading={true} />);
			expect(queryByText("42")).not.toBeInTheDocument();
		});

		it("renders content once loading is false", () => {
			const { getByText } = render(<MemoryCards {...defaultProps} loading={false} />);
			expect(getByText("42")).toBeInTheDocument();
		});
	});

	describe("handles empty state", () => {
		it("renders zero values gracefully", () => {
			const { getAllByText } = render(
				<MemoryCards
					memoryEntries={0}
					dbEntries={0}
					hits={0}
					misses={0}
					hitRate="0%"
					tokensSaved={0}
				/>
			);
			expect(getAllByText("0").length).toBeGreaterThan(0);
		});

		it("renders with null stats gracefully", () => {
			const { container } = render(<MemoryCards stats={null} />);
			expect(container).toBeInTheDocument();
		});
	});

	describe("handles API errors", () => {
		it("renders error message when error prop is provided", () => {
			const { getByText } = render(
				<MemoryCards {...defaultProps} error="Failed to load cache stats" />
			);
			expect(getByText(/failed to load cache stats/i)).toBeInTheDocument();
		});

		it("shows retry button on error", () => {
			const { getByRole } = render(
				<MemoryCards {...defaultProps} error="Network error" onRetry={vi.fn()} />
			);
			expect(getByRole("button", { name: /retry/i })).toBeInTheDocument();
		});

		it("calls onRetry when retry button clicked", async () => {
			const onRetry = vi.fn();
			const { getByRole } = render(
				<MemoryCards {...defaultProps} error="Network error" onRetry={onRetry} />
			);
			getByRole("button", { name: /retry/i }).click();
			expect(onRetry).toHaveBeenCalledOnce();
		});
	});
});
